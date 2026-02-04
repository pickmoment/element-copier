// Content script for Element to Markdown Copier
// Handles element selection, HTML to Markdown conversion, and clipboard operations

(function () {
    'use strict';

    // Check if already initialized
    if (window.mdcpInitialized) {
        console.log('Element to Markdown Copier already initialized');
        return;
    }
    window.mdcpInitialized = true;

    // State management
    let isSelectionMode = false;
    let currentElement = null;
    let selectedElements = []; // Array to store multiple selected elements
    let overlay = null;
    let floatingButton = null;
    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };
    let dragOffset = { x: 0, y: 0 };
    let wasDragged = false;
    let copyAsImage = false; // Flag to determine if copying as image

    // Area selection mode
    let isAreaSelectionMode = false;
    let isDrawingArea = false;
    let areaStartPos = { x: 0, y: 0 };
    let areaEndPos = { x: 0, y: 0 };
    let selectionBox = null;
    let justFinishedAreaSelection = false;

    // Initialize Turndown converter with GFM plugin for better table support
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
        linkStyle: 'inlined'
    });

    // Add GFM plugin for table support
    if (typeof turndownPluginGfm !== 'undefined') {
        const gfm = turndownPluginGfm.gfm;
        turndownService.use(gfm);
    }

    // Remove unwanted elements
    turndownService.remove(['script', 'style', 'noscript', 'iframe']);

    // Custom rule to handle SVG elements
    turndownService.addRule('svg', {
        filter: 'svg',
        replacement: function () {
            return '';
        }
    });

    /**
     * Show toast notification
     */
    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'mdcp-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    /**
     * Copy text to clipboard
     */
    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            showToast('✓ Markdown이 클립보드에 복사되었습니다!');
            return true;
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            showToast('✗ 클립보드 복사에 실패했습니다.');
            return false;
        }
    }

    /**
     * Copy multiple elements as image
     */
    async function copyMultipleElementsAsImage(elements) {
        try {
            showToast('이미지 생성 중...');

            // Find the bounding box that contains all selected elements
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            elements.forEach(el => {
                const rect = el.getBoundingClientRect();
                minX = Math.min(minX, rect.left);
                minY = Math.min(minY, rect.top);
                maxX = Math.max(maxX, rect.right);
                maxY = Math.max(maxY, rect.bottom);
            });

            // Calculate position including scroll offset
            const x = minX + window.scrollX;
            const y = minY + window.scrollY;
            const width = maxX - minX;
            const height = maxY - minY;

            // Capture the area containing all selected elements
            const canvas = await html2canvas(document.body, {
                backgroundColor: '#ffffff',
                logging: false,
                useCORS: true,
                allowTaint: true,
                scale: 2,
                x: x,
                y: y,
                width: width,
                height: height,
                scrollX: -window.scrollX,
                scrollY: -window.scrollY
            });

            // Convert canvas to blob
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

            // Copy to clipboard
            await navigator.clipboard.write([
                new ClipboardItem({
                    'image/png': blob
                })
            ]);

            showToast('✓ 이미지가 클립보드에 복사되었습니다!');
            return true;
        } catch (error) {
            console.error('Failed to copy image to clipboard:', error);
            showToast('✗ 이미지 복사에 실패했습니다.');
            return false;
        }
    }

    /**
     * Copy image to clipboard
     */
    async function copyImageToClipboard(element) {
        try {
            showToast('이미지 생성 중...');

            // Get element's position and size
            const rect = element.getBoundingClientRect();

            // Calculate position including scroll offset
            const x = rect.left + window.scrollX;
            const y = rect.top + window.scrollY;
            const width = rect.width;
            const height = rect.height;

            // Use html2canvas to capture the body and crop to element area
            const canvas = await html2canvas(document.body, {
                backgroundColor: '#ffffff',
                logging: false,
                useCORS: true,
                allowTaint: true,
                scale: 2,
                x: x,
                y: y,
                width: width,
                height: height,
                scrollX: -window.scrollX,
                scrollY: -window.scrollY
            });

            // Convert canvas to blob
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

            // Copy to clipboard
            await navigator.clipboard.write([
                new ClipboardItem({
                    'image/png': blob
                })
            ]);

            showToast('✓ 이미지가 클립보드에 복사되었습니다!');
            return true;
        } catch (error) {
            console.error('Failed to copy image to clipboard:', error);
            showToast('✗ 이미지 복사에 실패했습니다.');
            return false;
        }
    }

    /**
     * Check if current site is YouTube
     */
    function isYouTubeSite() {
        return window.location.hostname.includes('youtube.com');
    }

    /**
     * Extract YouTube video links from element
     */
    function extractYouTubeLinks(element) {
        const links = [];
        const linkElements = element.tagName === 'A' ? [element] : Array.from(element.querySelectorAll('a'));

        linkElements.forEach(link => {
            const href = link.href;
            // Match YouTube video URLs
            if (href && (href.includes('youtube.com/watch?v=') || href.includes('youtu.be/'))) {
                links.push(href);
            }
        });

        return links;
    }

    /**
     * Convert HTML element to Markdown
     */
    function convertToMarkdown(element) {
        try {
            // If on YouTube, extract only video links
            if (isYouTubeSite()) {
                const links = extractYouTubeLinks(element);
                if (links.length > 0) {
                    return links.join('\n');
                } else {
                    return '영상 링크가 없습니다.';
                }
            }

            // Clone the element to avoid modifying the original
            const clonedElement = element.cloneNode(true);

            // Remove any MDCP-specific classes
            clonedElement.classList.remove('mdcp-selected-element-outline');

            // Get the HTML content
            const html = clonedElement.outerHTML;

            // Convert to Markdown
            const markdown = turndownService.turndown(html);

            return markdown;
        } catch (error) {
            console.error('Failed to convert to Markdown:', error);
            return null;
        }
    }

    /**
     * Handle mouse over event
     */
    function handleMouseOver(event) {
        if (!isSelectionMode) return;

        // Don't highlight elements in area selection mode
        if (isAreaSelectionMode) return;

        // Ignore hover on floating button and overlay
        if (event.target === floatingButton || floatingButton.contains(event.target) ||
            event.target === overlay) {
            return;
        }

        // Prevent default behavior
        event.preventDefault();
        event.stopPropagation();

        // Remove highlight from previous element
        if (currentElement && currentElement !== event.target) {
            currentElement.classList.remove('mdcp-selected-element-outline');
        }

        // Highlight current element
        currentElement = event.target;
        currentElement.classList.add('mdcp-selected-element-outline');

        // Temporarily hide floating button when hovering over elements
        if (floatingButton && !floatingButton.classList.contains('mdcp-dragging')) {
            floatingButton.style.opacity = '0.1';
        }
    }

    /**
     * Handle mouse out event
     */
    function handleMouseOut(event) {
        if (!isSelectionMode) return;

        // Don't handle in area selection mode
        if (isAreaSelectionMode) return;

        event.preventDefault();
        event.stopPropagation();

        // Restore floating button opacity when not hovering
        if (floatingButton && event.target === currentElement) {
            floatingButton.style.opacity = '';
        }
    }

    /**
     * Handle mouse down for area selection
     */
    function handleMouseDown(event) {
        if (!isSelectionMode) return;

        // Only start area selection if Alt/Option key is pressed
        if (!event.altKey) return;

        // Ignore if clicking on floating button
        if (event.target === floatingButton || floatingButton.contains(event.target)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        isDrawingArea = true;
        areaStartPos = { x: event.clientX, y: event.clientY };
        areaEndPos = { x: event.clientX, y: event.clientY };

        // Create selection box
        createSelectionBox();
    }

    /**
     * Handle mouse move for area selection
     */
    function handleMouseMoveArea(event) {
        if (!isSelectionMode || !isDrawingArea) return;

        event.preventDefault();
        event.stopPropagation();

        areaEndPos = { x: event.clientX, y: event.clientY };
        updateSelectionBox();
    }

    /**
     * Handle mouse up for area selection
     */
    function handleMouseUp(event) {
        if (!isSelectionMode || !isDrawingArea) return;

        event.preventDefault();
        event.stopPropagation();

        isDrawingArea = false;
        justFinishedAreaSelection = true;

        // Reset flag after a short delay to prevent immediate click
        setTimeout(() => {
            justFinishedAreaSelection = false;
        }, 100);

        // Find all elements within the selection box
        const selectedInArea = getElementsInArea(areaStartPos, areaEndPos);

        // Add to selected elements
        selectedInArea.forEach(el => {
            if (!selectedElements.includes(el)) {
                selectedElements.push(el);
                el.classList.add('mdcp-multi-selected');
            }
        });

        // Remove selection box
        removeSelectionBox();

        if (selectedInArea.length > 0) {
            showToast(`${selectedElements.length}개 요소 선택됨 (엔터키로 복사)`);
        } else {
            showToast('영역 내에 요소가 없습니다.');
        }
    }

    /**
     * Create selection box element
     */
    function createSelectionBox() {
        if (selectionBox) {
            removeSelectionBox();
        }

        selectionBox = document.createElement('div');
        selectionBox.className = 'mdcp-selection-box';
        document.body.appendChild(selectionBox);
        updateSelectionBox();
    }

    /**
     * Update selection box position and size
     */
    function updateSelectionBox() {
        if (!selectionBox) return;

        const left = Math.min(areaStartPos.x, areaEndPos.x);
        const top = Math.min(areaStartPos.y, areaEndPos.y);
        const width = Math.abs(areaEndPos.x - areaStartPos.x);
        const height = Math.abs(areaEndPos.y - areaStartPos.y);

        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';
    }

    /**
     * Remove selection box
     */
    function removeSelectionBox() {
        if (selectionBox) {
            selectionBox.remove();
            selectionBox = null;
        }
    }

    /**
     * Get all elements within the selection area
     */
    function getElementsInArea(start, end) {
        const left = Math.min(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const right = Math.max(start.x, end.x);
        const bottom = Math.max(start.y, end.y);

        const selectionWidth = right - left;
        const selectionHeight = bottom - top;

        const elements = [];
        const allElements = document.querySelectorAll('body *');

        allElements.forEach(el => {
            // Skip our own elements
            if (el === floatingButton || floatingButton.contains(el) ||
                el === overlay || el === selectionBox ||
                el.classList.contains('mdcp-toast')) {
                return;
            }

            const rect = el.getBoundingClientRect();

            // Skip elements that are too large (likely container elements)
            // Only select if element is not significantly larger than selection area
            const elementArea = rect.width * rect.height;
            const selectionArea = selectionWidth * selectionHeight;

            // Skip if element is more than 3x the selection area
            if (elementArea > selectionArea * 3) {
                return;
            }

            // Check if element's center point is within selection area
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            if (centerX >= left && centerX <= right &&
                centerY >= top && centerY <= bottom) {
                elements.push(el);
            }
        });

        // If a parent's ALL direct children are selected, keep only the parent and remove children
        const optimizedElements = [...elements];

        elements.forEach(parent => {
            // Get all descendants of this parent that are in the selection
            const descendants = elements.filter(el =>
                el !== parent && parent.contains(el)
            );

            if (descendants.length > 0) {
                // Get all actual direct children of parent element
                const allDirectChildren = Array.from(parent.children);

                // Check if all visible direct children are in the selection
                const visibleChildren = allDirectChildren.filter(child => {
                    const rect = child.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });

                const selectedVisibleChildren = visibleChildren.filter(child =>
                    elements.includes(child)
                );

                // If all visible direct children are selected, remove them and keep only parent
                if (visibleChildren.length > 0 &&
                    selectedVisibleChildren.length === visibleChildren.length) {
                    // Remove all descendants from the list
                    descendants.forEach(child => {
                        const index = optimizedElements.indexOf(child);
                        if (index > -1) {
                            optimizedElements.splice(index, 1);
                        }
                    });
                }
            }
        });

        return optimizedElements;
    }

    /**
     * Process and copy selected elements
     */
    function processAndCopy() {
        const elementsToProcess = selectedElements.length > 0 ? selectedElements : (currentElement ? [currentElement] : []);

        if (elementsToProcess.length === 0) {
            showToast('✗ 선택된 요소가 없습니다.');
            return;
        }

        if (copyAsImage) {
            // Copy as image
            if (elementsToProcess.length === 1) {
                copyImageToClipboard(elementsToProcess[0]);
            } else {
                // For multiple elements, create a wrapper and capture it
                copyMultipleElementsAsImage(elementsToProcess);
            }
        } else {
            // Convert to Markdown
            const markdowns = elementsToProcess.map(el => convertToMarkdown(el)).filter(md => md);

            if (markdowns.length > 0) {
                let combinedMarkdown;

                // For YouTube, deduplicate links
                if (isYouTubeSite()) {
                    // Split all links and deduplicate
                    const allLinks = markdowns.flatMap(md => md.split('\n').filter(line => line.trim()));
                    // Filter out non-link text like "영상 링크가 없습니다."
                    const videoLinks = allLinks.filter(link =>
                        link.includes('youtube.com/watch?v=') || link.includes('youtu.be/')
                    );
                    const uniqueLinks = [...new Set(videoLinks)];

                    if (uniqueLinks.length > 0) {
                        combinedMarkdown = uniqueLinks.join('\n');
                    } else {
                        showToast('✗ 영상 링크가 없습니다.');
                        deactivateSelectionMode();
                        return;
                    }
                } else {
                    combinedMarkdown = markdowns.join('\n\n');
                }

                // Copy to clipboard
                copyToClipboard(combinedMarkdown);
            } else {
                showToast('✗ Markdown 변환에 실패했습니다.');
            }
        }

        // Clean up
        deactivateSelectionMode();
    }

    /**
     * Handle click event
     */
    function handleClick(event) {
        if (!isSelectionMode) return;

        // Ignore clicks on floating button
        if (event.target === floatingButton || floatingButton.contains(event.target)) {
            return;
        }

        // Ignore click immediately after area selection
        if (justFinishedAreaSelection) {
            return;
        }

        // Prevent default behavior and stop propagation
        event.preventDefault();
        event.stopPropagation();

        if (currentElement) {
            // Toggle selection: if already selected, remove it; otherwise add it
            const index = selectedElements.indexOf(currentElement);
            if (index > -1) {
                // Element is already selected, remove it
                selectedElements.splice(index, 1);
                currentElement.classList.remove('mdcp-selected-element-outline');
                currentElement.classList.remove('mdcp-multi-selected');
                showToast(`선택 해제됨 (${selectedElements.length}개 선택됨)`);
            } else {
                // Add to selection
                selectedElements.push(currentElement);
                currentElement.classList.add('mdcp-multi-selected');
                showToast(`${selectedElements.length}개 요소 선택됨 (엔터키로 복사)`);
            }
        }
    }

    /**
     * Handle keydown event (ESC to cancel, Shift to hide button, Alt for area selection, Enter to copy)
     */
    function handleKeyDown(event) {
        if (!isSelectionMode) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();

            // Cancel area selection if in progress
            if (isDrawingArea) {
                isDrawingArea = false;
                removeSelectionBox();
                showToast('영역 선택이 취소되었습니다.');
            } else {
                showToast('선택 모드가 취소되었습니다.');
                deactivateSelectionMode();
            }
        } else if (event.key === 'Enter') {
            // Copy selected elements
            event.preventDefault();
            event.stopPropagation();
            processAndCopy();
        } else if (event.key === 'Shift') {
            // Temporarily hide floating button when Shift is pressed
            if (floatingButton) {
                floatingButton.style.display = 'none';
            }
        } else if (event.key === 'Alt') {
            // Enable area selection mode
            if (!isAreaSelectionMode) {
                isAreaSelectionMode = true;
                document.body.style.cursor = 'crosshair';
                showToast('영역 선택 모드 (드래그하여 영역 선택)');
            }
        }
    }

    /**
     * Handle keyup event (restore button visibility, disable area selection)
     */
    function handleKeyUp(event) {
        if (!isSelectionMode) return;

        if (event.key === 'Shift') {
            // Restore floating button when Shift is released
            if (floatingButton) {
                floatingButton.style.display = '';
            }
        } else if (event.key === 'Alt') {
            // Disable area selection mode
            if (isAreaSelectionMode && !isDrawingArea) {
                isAreaSelectionMode = false;
                document.body.style.cursor = '';
                showToast('영역 선택 모드 종료');
            }
        }
    }

    /**
     * Create floating button
     */
    async function createFloatingButton() {
        floatingButton = document.createElement('div');
        floatingButton.className = 'mdcp-floating-button';
        floatingButton.innerHTML = '📋';
        floatingButton.title = '요소 복사 모드 시작\n우클릭: 이미지로 복사';
        document.body.appendChild(floatingButton);

        // Restore last position from chrome.storage
        try {
            const result = await chrome.storage.local.get('mdcp-button-position');
            const savedPosition = result['mdcp-button-position'];
            if (savedPosition) {
                const { x, y } = savedPosition;
                // Validate position is within viewport
                const maxX = window.innerWidth - floatingButton.offsetWidth;
                const maxY = window.innerHeight - floatingButton.offsetHeight;
                const validX = Math.max(0, Math.min(x, maxX));
                const validY = Math.max(0, Math.min(y, maxY));
                floatingButton.style.left = validX + 'px';
                floatingButton.style.top = validY + 'px';
                floatingButton.style.bottom = 'auto';
                floatingButton.style.right = 'auto';
            }
        } catch (e) {
            console.error('Failed to restore button position:', e);
        }

        // Button click event
        floatingButton.addEventListener('click', handleFloatingButtonClick);
        
        // Right click for image mode
        floatingButton.addEventListener('contextmenu', handleFloatingButtonRightClick);

        // Drag events
        floatingButton.addEventListener('mousedown', handleDragStart);
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
    }

    /**
     * Handle floating button click
     */
    function handleFloatingButtonClick(event) {
        // Ignore click if it was a drag
        if (wasDragged) {
            wasDragged = false;
            return;
        }
        
        event.stopPropagation();
        event.preventDefault();
        
        if (!isSelectionMode) {
            copyAsImage = false;
            activateSelectionMode();
        } else {
            deactivateSelectionMode();
        }
    }

    /**
     * Handle floating button right click (for image mode)
     */
    function handleFloatingButtonRightClick(event) {
        event.preventDefault();
        event.stopPropagation();
        
        if (!isSelectionMode) {
            copyAsImage = true;
            activateSelectionMode('이미지');
        } else {
            deactivateSelectionMode();
        }
    }

    /**
     * Handle drag start
     */
    function handleDragStart(event) {
        if (event.button !== 0) return; // Only left mouse button
        
        isDragging = true;
        wasDragged = false;
        dragStartPos.x = event.clientX;
        dragStartPos.y = event.clientY;
        floatingButton.classList.add('mdcp-dragging');
        
        const rect = floatingButton.getBoundingClientRect();
        dragOffset.x = event.clientX - rect.left;
        dragOffset.y = event.clientY - rect.top;
        
        event.preventDefault();
        event.stopPropagation();
    }

    /**
     * Handle drag move
     */
    function handleDragMove(event) {
        if (!isDragging) return;
        
        // Check if actually moved (threshold of 5px)
        const deltaX = Math.abs(event.clientX - dragStartPos.x);
        const deltaY = Math.abs(event.clientY - dragStartPos.y);
        if (deltaX > 5 || deltaY > 5) {
            wasDragged = true;
        }
        
        event.preventDefault();
        event.stopPropagation();
        
        const x = event.clientX - dragOffset.x;
        const y = event.clientY - dragOffset.y;
        
        // Keep button within viewport
        const maxX = window.innerWidth - floatingButton.offsetWidth;
        const maxY = window.innerHeight - floatingButton.offsetHeight;
        
        const boundedX = Math.max(0, Math.min(x, maxX));
        const boundedY = Math.max(0, Math.min(y, maxY));
        
        floatingButton.style.left = boundedX + 'px';
        floatingButton.style.top = boundedY + 'px';
    }

    /**
     * Handle drag end
     */
    function handleDragEnd(event) {
        if (isDragging) {
            isDragging = false;
            floatingButton.classList.remove('mdcp-dragging');
            event.stopPropagation();
            
            // Save button position to chrome.storage
            if (wasDragged) {
                const rect = floatingButton.getBoundingClientRect();
                const position = {
                    x: rect.left,
                    y: rect.top
                };
                chrome.storage.local.set({ 'mdcp-button-position': position });
            }
        }
    }

    /**
     * Activate selection mode
     */
    function activateSelectionMode(mode = 'Markdown') {
        if (isSelectionMode) {
            showToast('선택 모드가 이미 활성화되어 있습니다.');
            return;
        }

        isSelectionMode = true;
        window.mdcpSelectionActive = true;

        // Update button appearance for active mode
        if (floatingButton) {
            floatingButton.classList.add('mdcp-active');
            floatingButton.innerHTML = copyAsImage ? '🖼️' : '✕';
            floatingButton.title = '선택 모드 종료';
        }

        // Create overlay
        overlay = document.createElement('div');
        overlay.className = 'mdcp-selection-overlay';
        document.body.appendChild(overlay);

        // Add event listeners
        document.addEventListener('mouseover', handleMouseOver, true);
        document.addEventListener('mouseout', handleMouseOut, true);
        document.addEventListener('click', handleClick, true);
        document.addEventListener('mousedown', handleMouseDown, true);
        document.addEventListener('mousemove', handleMouseMoveArea, true);
        document.addEventListener('mouseup', handleMouseUp, true);
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);

        const modeText = copyAsImage ? '이미지' : 'Markdown';
        showToast(`요소를 클릭하여 선택하세요 (Alt+드래그: 영역 선택, Enter: 복사, ESC: 취소)`);
    }

    /**
     * Deactivate selection mode
     */
    function deactivateSelectionMode() {
        if (!isSelectionMode) return;

        isSelectionMode = false;
        window.mdcpSelectionActive = false;
        copyAsImage = false; // Reset flag
        isAreaSelectionMode = false;
        isDrawingArea = false;
        justFinishedAreaSelection = false;

        // Remove highlight from current element
        if (currentElement) {
            currentElement.classList.remove('mdcp-selected-element-outline');
            currentElement = null;
        }

        // Remove highlight from all selected elements
        selectedElements.forEach(el => {
            el.classList.remove('mdcp-selected-element-outline');
            el.classList.remove('mdcp-multi-selected');
        });
        selectedElements = [];

        // Remove overlay
        if (overlay) {
            overlay.remove();
            overlay = null;
        }

        // Remove selection box
        removeSelectionBox();

        // Reset cursor
        document.body.style.cursor = '';

        // Reset button appearance
        if (floatingButton) {
            floatingButton.classList.remove('mdcp-active');
            floatingButton.innerHTML = '📋';
            floatingButton.title = '요소 복사 모드 시작\n우클릭: 이미지로 복사';
            floatingButton.style.opacity = '';
            floatingButton.style.display = '';
        }

        // Remove event listeners
        document.removeEventListener('mouseover', handleMouseOver, true);
        document.removeEventListener('mouseout', handleMouseOut, true);
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('mousedown', handleMouseDown, true);
        document.removeEventListener('mousemove', handleMouseMoveArea, true);
        document.removeEventListener('mouseup', handleMouseUp, true);
        document.removeEventListener('keydown', handleKeyDown, true);
        document.removeEventListener('keyup', handleKeyUp, true);
    }

    // Initialize floating button when script is injected
    createFloatingButton();

    console.log('Element to Markdown Copier initialized');
})();

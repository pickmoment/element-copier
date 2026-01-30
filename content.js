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
            
            const width = maxX - minX;
            const height = maxY - minY;
            
            // Capture the area containing all selected elements
            const canvas = await html2canvas(document.body, {
                backgroundColor: '#ffffff',
                logging: false,
                useCORS: true,
                allowTaint: true,
                scale: 2,
                scrollX: 0,
                scrollY: 0,
                windowWidth: document.documentElement.scrollWidth,
                windowHeight: document.documentElement.scrollHeight,
                x: minX + window.pageXOffset,
                y: minY + window.pageYOffset,
                width: width,
                height: height
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
            
            // Use html2canvas to capture the element as it appears on screen
            const canvas = await html2canvas(element, {
                backgroundColor: '#ffffff', // Use white background to match screen appearance
                logging: false,
                useCORS: true,
                allowTaint: true,
                scale: 2, // Higher quality
                scrollX: 0,
                scrollY: 0,
                windowWidth: document.documentElement.scrollWidth,
                windowHeight: document.documentElement.scrollHeight,
                x: rect.left + window.pageXOffset,
                y: rect.top + window.pageYOffset,
                width: rect.width,
                height: rect.height
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
     * Convert HTML element to Markdown
     */
    function convertToMarkdown(element) {
        try {
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

        event.preventDefault();
        event.stopPropagation();
        
        // Restore floating button opacity when not hovering
        if (floatingButton && event.target === currentElement) {
            floatingButton.style.opacity = '';
        }
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

        // Prevent default behavior and stop propagation
        event.preventDefault();
        event.stopPropagation();

        if (currentElement) {
            // Check if Command key (Meta key on Mac) or Ctrl key (on Windows/Linux) is pressed
            if (event.metaKey || event.ctrlKey) {
                // Multi-select mode
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
                    showToast(`${selectedElements.length}개 요소 선택됨 (Command 없이 클릭하여 복사)`);
                }
                return;
            }

            // Normal click without Command key
            const elementsToProcess = selectedElements.length > 0 ? selectedElements : [currentElement];
            
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
                    const combinedMarkdown = markdowns.join('\n\n');
                    // Copy to clipboard
                    copyToClipboard(combinedMarkdown);
                } else {
                    showToast('✗ Markdown 변환에 실패했습니다.');
                }
            }

            // Clean up
            deactivateSelectionMode();
        }
    }

    /**
     * Handle keydown event (ESC to cancel, Shift to hide button)
     */
    function handleKeyDown(event) {
        if (!isSelectionMode) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            showToast('선택 모드가 취소되었습니다.');
            deactivateSelectionMode();
        } else if (event.key === 'Shift') {
            // Temporarily hide floating button when Shift is pressed
            if (floatingButton) {
                floatingButton.style.display = 'none';
            }
        }
    }

    /**
     * Handle keyup event (restore button visibility)
     */
    function handleKeyUp(event) {
        if (!isSelectionMode) return;

        if (event.key === 'Shift') {
            // Restore floating button when Shift is released
            if (floatingButton) {
                floatingButton.style.display = '';
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
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);

        const modeText = copyAsImage ? '이미지' : 'Markdown';
        showToast(`요소를 클릭하여 ${modeText}로 복사하세요 (Cmd+클릭: 다중 선택, Shift: 버튼 숨기기, ESC: 취소)`);
    }

    /**
     * Deactivate selection mode
     */
    function deactivateSelectionMode() {
        if (!isSelectionMode) return;

        isSelectionMode = false;
        window.mdcpSelectionActive = false;
        copyAsImage = false; // Reset flag

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
        document.removeEventListener('keydown', handleKeyDown, true);
        document.removeEventListener('keyup', handleKeyUp, true);
    }

    // Initialize floating button when script is injected
    createFloatingButton();

    console.log('Element to Markdown Copier initialized');
})();

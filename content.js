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

    // Preview panel state
    let previewPanel = null;
    let previewState = {
        markdown: '',
        activeTab: 'render',
        height: 0,
        width: 0,
        left: null,
        top: null
    };
    let previewImageUrl = null;
    let isPreviewDragging = false;
    let previewDragOffset = { x: 0, y: 0 };
    let isPreviewResizing = false;
    let previewResizeStart = { x: 0, y: 0, width: 0, height: 0 };

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

    function isSimpleTable(table) {
        if (!table || table.querySelector('table')) return false;
        const cells = table.querySelectorAll('th, td');
        for (const cell of cells) {
            if (cell.hasAttribute('rowspan') || cell.hasAttribute('colspan')) return false;
            const hasBlock = cell.querySelector('p, div, ul, ol, li, table, img, br');
            if (hasBlock) return false;
        }
        return true;
    }

    function tableToMarkdown(table) {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length === 0) return '';

        const rowToCells = (row) => {
            const cells = Array.from(row.children).filter(el => el.tagName === 'TH' || el.tagName === 'TD');
            return cells.map(cell => {
                const text = cell.textContent.replace(/\s+/g, ' ').trim();
                return text.replace(/\|/g, '\\|');
            });
        };

        let header = [];
        let bodyStart = 0;

        const firstRowCells = rowToCells(rows[0]);
        const firstRowHasTh = rows[0].querySelectorAll('th').length === firstRowCells.length && firstRowCells.length > 0;

        if (firstRowHasTh) {
            header = firstRowCells;
            bodyStart = 1;
        } else {
            header = firstRowCells;
            bodyStart = 1;
        }

        const colCount = header.length || Math.max(...rows.map(r => rowToCells(r).length));
        const normalizeRow = (cells) => {
            const normalized = cells.slice(0, colCount);
            while (normalized.length < colCount) normalized.push('');
            return normalized;
        };

        const headerRow = normalizeRow(header);
        const separator = headerRow.map(() => '---');
        const bodyRows = rows.slice(bodyStart).map(row => normalizeRow(rowToCells(row)));

        const toLine = (cells) => `| ${cells.join(' | ')} |`;
        const lines = [
            toLine(headerRow),
            toLine(separator),
            ...bodyRows.map(toLine)
        ];
        return lines.join('\n');
    }

    turndownService.addRule('tableConversion', {
        filter: 'table',
        replacement: function (content, node) {
            if (isSimpleTable(node)) {
                const md = tableToMarkdown(node);
                if (md) {
                    return `\n\n${md}\n\n`;
                }
            }
            return `\n\n${node.outerHTML}\n\n`;
        }
    });

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
    function showToast(message, anchor = null) {
        const toast = document.createElement('div');
        toast.className = 'mdcp-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        if (anchor) {
            let target = null;
            if (anchor instanceof Element) {
                target = anchor;
            } else if (anchor instanceof MouseEvent || anchor instanceof PointerEvent || anchor.target) {
                target = anchor.target;
            }

            if (target && target instanceof Element) {
                const rect = target.getBoundingClientRect();
                toast.style.position = 'fixed';
                toast.style.top = `${Math.max(10, rect.top - 45)}px`;
                toast.style.left = `${rect.left + rect.width / 2}px`;
                toast.style.right = 'auto';
                toast.style.transform = 'translateX(-50%)';
                toast.style.animation = 'mdcp-fadeInUp 0.3s ease-out, mdcp-fadeOut 0.3s ease-in 2.7s';

                // If there's no space above, show below
                if (rect.top < 60) {
                    toast.style.top = `${rect.bottom + 10}px`;
                }
            }
        }

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    /**
     * Copy text to clipboard
     */
    async function copyToClipboard(text, customMessage = null, anchor = null) {
        try {
            await navigator.clipboard.writeText(text);
            showToast(customMessage || '✓ Markdown이 클립보드에 복사되었습니다!', anchor);
            return true;
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            showToast('✗ 클립보드 복사에 실패했습니다.', anchor);
            return false;
        }
    }

    /**
     * Escape HTML special chars
     */
    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Sanitize HTML table for safe rendering
     */
    function sanitizeTableHtml(tableHtml) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(tableHtml, 'text/html');
            const table = doc.querySelector('table');
            if (!table) return '';

            const allowedTags = new Set([
                'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'COLGROUP', 'COL',
                'A', 'IMG', 'SPAN', 'P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'BR', 'TIME',
                'DIV', 'BUTTON'
            ]);
            const allowedAttrs = new Set([
                'colspan', 'rowspan', 'align', 'style',
                'href', 'title', 'target', 'rel',
                'src', 'alt', 'width', 'height',
                'datetime', 'class'
            ]);

            const walk = (node) => {
                const children = Array.from(node.children || []);
                children.forEach(child => {
                    if (!allowedTags.has(child.tagName)) {
                        // Unwrap disallowed tags but keep their text/content
                        while (child.firstChild) {
                            child.parentNode.insertBefore(child.firstChild, child);
                        }
                        child.remove();
                        return;
                    }

                    Array.from(child.attributes).forEach(attr => {
                        if (!allowedAttrs.has(attr.name.toLowerCase())) {
                            child.removeAttribute(attr.name);
                        }
                    });

                    walk(child);
                });
            };

            walk(table);
            return table.outerHTML;
        } catch (error) {
            console.error('Failed to sanitize table HTML:', error);
            return '';
        }
    }

    /**
     * Normalize broken GFM tables with line breaks between pipes
     */
    function normalizeMarkdownTables(text) {
        const segments = text.split(/```/);
        const normalized = segments.map((segment, index) => {
            if (index % 2 === 1) {
                return segment;
            }

            const lines = segment.split('\n');
            const out = [];
            let i = 0;
            while (i < lines.length) {
                const line = lines[i];
                const trimmed = line.trim();
                const nextNonEmptyIndex = (() => {
                    let j = i + 1;
                    while (j < lines.length && lines[j].trim() === '') j++;
                    return j;
                })();

                const looksLikeSeparator = (value) => {
                    if (!value.includes('|')) return false;
                    const parts = value.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
                    return parts.length >= 2 && parts.every(part => /^\s*:?-{3,}:?\s*$/.test(part));
                };

                const isTableStart =
                    trimmed.includes('|') &&
                    nextNonEmptyIndex < lines.length &&
                    looksLikeSeparator(lines[nextNonEmptyIndex]);

                if (!isTableStart) {
                    out.push(line);
                    i += 1;
                    continue;
                }

                const tableLines = [];
                let inTable = true;
                while (i < lines.length && inTable) {
                    const current = lines[i];
                    const currentTrimmed = current.trim();

                    if (currentTrimmed === '') {
                        tableLines.push(current);
                        i += 1;
                        continue;
                    }

                    if (!current.includes('|') && !looksLikeSeparator(current)) {
                        const hasSeparator = tableLines.some(looksLikeSeparator);
                        if (hasSeparator) {
                            inTable = false;
                            break;
                        }
                    }

                    tableLines.push(current);
                    i += 1;
                }

                const rows = [];
                let rowBuffer = '';
                const pushRow = () => {
                    if (rowBuffer.trim() !== '') {
                        rows.push(rowBuffer.trim());
                        rowBuffer = '';
                    }
                };

                for (let t = 0; t < tableLines.length; t++) {
                    const raw = tableLines[t];
                    const tline = raw.trim();
                    const isSeparator = looksLikeSeparator(raw);

                    if (tline === '') {
                        if (rowBuffer !== '') {
                            rowBuffer += ' ';
                        }
                        continue;
                    }

                    if (isSeparator) {
                        pushRow();
                        rows.push(tline);
                        continue;
                    }

                    if (rowBuffer === '') {
                        rowBuffer = raw;
                        continue;
                    }

                    if (raw.includes('|') && rowBuffer.includes('|') && rowBuffer.trim().endsWith('|')) {
                        pushRow();
                        rowBuffer = raw;
                        continue;
                    }

                    rowBuffer += ` ${tline}`;
                }
                pushRow();

                out.push(...rows);
            }

            return out.join('\n');
        });
        return normalized.join('```');
    }

    function normalizeMarkdownForRendering(markdown) {
        // Remove up to 3 leading spaces before ATX headings so they render as headers
        return markdown.replace(/^\s{1,3}(#{1,6}\s+)/gm, '$1');
    }

    function markdownToHtml(markdown) {
        const tableTokens = [];
        const markdownWithTables = markdown.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
            const sanitized = sanitizeTableHtml(match);
            const token = `[[MDCP_TABLE_${tableTokens.length}]]`;
            tableTokens.push(sanitized || '');
            return token;
        });

        if (typeof marked === 'undefined') {
            return `<pre><code>${escapeHtml(markdownWithTables)}</code></pre>`;
        }

        const normalizedMarkdown = normalizeMarkdownForRendering(
            normalizeMarkdownTables(markdownWithTables)
        );

        marked.setOptions({
            gfm: true,
            breaks: true,
            mangle: false,
            headerIds: false
        });

        let rendered = '';
        try {
            rendered = marked.parse(normalizedMarkdown);
        } catch (error) {
            console.error('Marked render failed:', error);
            rendered = `<pre><code>${escapeHtml(normalizedMarkdown)}</code></pre>`;
        }
        tableTokens.forEach((tableHtml, index) => {
            const token = `[[MDCP_TABLE_${index}]]`;
            rendered = rendered.replaceAll(token, tableHtml || '');
        });
        return rendered || '<p>(내용 없음)</p>';
    }

    /**
     * Extract links from markdown text
     */
    function extractLinksFromMarkdown(markdown) {
        const links = new Set();
        const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
        const autoLinkRegex = /<\s*(https?:\/\/[^>]+)\s*>/g;
        const bareUrlRegex = /(https?:\/\/[^\s)]+)\b/g;

        let match;
        while ((match = linkRegex.exec(markdown)) !== null) {
            links.add(match[2]);
        }
        while ((match = autoLinkRegex.exec(markdown)) !== null) {
            links.add(match[1]);
        }
        while ((match = bareUrlRegex.exec(markdown)) !== null) {
            links.add(match[1]);
        }

        return Array.from(links);
    }

    /**
     * Create or update preview panel
     */
    function showPreviewPanel(markdown) {
        previewState.markdown = markdown;

        if (!previewPanel) {
            previewPanel = document.createElement('div');
            previewPanel.className = 'mdcp-preview-panel';
            previewPanel.innerHTML = `
                <div class="mdcp-preview-header">
                    <div class="mdcp-preview-title">Markdown 미리보기</div>
                    <div class="mdcp-preview-actions">
                        <button class="mdcp-preview-copy">복사</button>
                        <button class="mdcp-preview-close">닫기</button>
                    </div>
                </div>
                <div class="mdcp-preview-tabs">
                    <button class="mdcp-preview-tab active" data-tab="render">렌더링</button>
                    <button class="mdcp-preview-tab" data-tab="edit">수정</button>
                    <button class="mdcp-preview-tab" data-tab="links">링크</button>
                </div>
                <div class="mdcp-preview-body">
                    <div class="mdcp-preview-pane" data-pane="render"></div>
                    <div class="mdcp-preview-pane mdcp-preview-pane-hidden" data-pane="edit">
                        <textarea class="mdcp-preview-textarea" spellcheck="false"></textarea>
                    </div>
                    <div class="mdcp-preview-pane mdcp-preview-pane-hidden" data-pane="links">
                        <div class="mdcp-preview-links"></div>
                    </div>
                </div>
                <div class="mdcp-preview-resize-handle tl" data-resize="tl" title="크기 변경"></div>
                <div class="mdcp-preview-resize-handle tr" data-resize="tr" title="크기 변경"></div>
                <div class="mdcp-preview-resize-handle bl" data-resize="bl" title="크기 변경"></div>
                <div class="mdcp-preview-resize-handle br" data-resize="br" title="크기 변경"></div>
            `;
            document.body.appendChild(previewPanel);

            const header = previewPanel.querySelector('.mdcp-preview-header');
            header.addEventListener('mousedown', (event) => {
                if (event.button !== 0) return;
                isPreviewDragging = true;
                const rect = previewPanel.getBoundingClientRect();
                previewDragOffset.x = event.clientX - rect.left;
                previewDragOffset.y = event.clientY - rect.top;
                event.preventDefault();
            });

            const resizeHandles = previewPanel.querySelectorAll('.mdcp-preview-resize-handle');
            resizeHandles.forEach(handle => handle.addEventListener('mousedown', (event) => {
                if (event.button !== 0) return;
                isPreviewResizing = true;
                const rect = previewPanel.getBoundingClientRect();
                previewResizeStart = {
                    x: event.clientX,
                    y: event.clientY,
                    width: rect.width,
                    height: rect.height,
                    left: rect.left,
                    top: rect.top,
                    handle: event.currentTarget.getAttribute('data-resize')
                };
                event.preventDefault();
                event.stopPropagation();
            }));

            document.addEventListener('mousemove', (event) => {
                if (isPreviewDragging) {
                    const maxX = window.innerWidth - previewPanel.offsetWidth;
                    const maxY = window.innerHeight - previewPanel.offsetHeight;
                    const nextLeft = Math.max(12, Math.min(event.clientX - previewDragOffset.x, maxX - 12));
                    const nextTop = Math.max(12, Math.min(event.clientY - previewDragOffset.y, maxY - 12));
                    previewPanel.style.left = `${nextLeft}px`;
                    previewPanel.style.top = `${nextTop}px`;
                    previewPanel.style.right = 'auto';
                    previewPanel.style.bottom = 'auto';
                }

                if (isPreviewResizing) {
                    const deltaX = event.clientX - previewResizeStart.x;
                    const deltaY = event.clientY - previewResizeStart.y;
                    let nextWidth = previewResizeStart.width;
                    let nextHeight = previewResizeStart.height;
                    let nextLeft = previewResizeStart.left;
                    let nextTop = previewResizeStart.top;

                    if (previewResizeStart.handle.includes('r')) {
                        nextWidth = Math.max(360, previewResizeStart.width + deltaX);
                    }
                    if (previewResizeStart.handle.includes('l')) {
                        nextWidth = Math.max(360, previewResizeStart.width - deltaX);
                        nextLeft = previewResizeStart.left + deltaX;
                    }
                    if (previewResizeStart.handle.includes('b')) {
                        nextHeight = Math.max(260, previewResizeStart.height + deltaY);
                    }
                    if (previewResizeStart.handle.includes('t')) {
                        nextHeight = Math.max(260, previewResizeStart.height - deltaY);
                        nextTop = previewResizeStart.top + deltaY;
                    }

                    const maxLeft = window.innerWidth - nextWidth - 12;
                    const maxTop = window.innerHeight - nextHeight - 12;
                    nextLeft = Math.max(12, Math.min(nextLeft, maxLeft));
                    nextTop = Math.max(12, Math.min(nextTop, maxTop));

                    previewPanel.style.left = `${nextLeft}px`;
                    previewPanel.style.top = `${nextTop}px`;
                    previewPanel.style.right = 'auto';
                    previewPanel.style.bottom = 'auto';
                    previewPanel.style.width = `${nextWidth}px`;
                    previewPanel.style.height = `${nextHeight}px`;
                }
            });

            document.addEventListener('mouseup', () => {
                isPreviewDragging = false;
                isPreviewResizing = false;
            });

            const closeButton = previewPanel.querySelector('.mdcp-preview-close');
            closeButton.addEventListener('click', () => {
                if (previewImageUrl) {
                    URL.revokeObjectURL(previewImageUrl);
                    previewImageUrl = null;
                }
                previewPanel.remove();
                previewPanel = null;
            });

            const copyButton = previewPanel.querySelector('.mdcp-preview-copy');
            copyButton.addEventListener('click', async (event) => {
                if (previewState.activeTab === 'links') {
                    const links = extractLinksFromMarkdown(previewState.markdown).filter(link => link.trim() !== '');
                    if (links.length > 0) {
                        await copyToClipboard(links.join('\n'), '✓ 추출된 링크가 클립보드에 복사되었습니다!', event);
                    } else {
                        showToast('추출된 링크가 없습니다.', event);
                    }
                } else {
                    await copyToClipboard(previewState.markdown, null, event);
                }
            });

            const tabs = previewPanel.querySelectorAll('.mdcp-preview-tab');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const target = tab.getAttribute('data-tab');
                    setPreviewTab(target);
                });
            });

            const textarea = previewPanel.querySelector('.mdcp-preview-textarea');
            textarea.addEventListener('input', () => {
                previewState.markdown = textarea.value;
                updatePreviewContent();
            });
        }

        const titleEl = previewPanel.querySelector('.mdcp-preview-title');
        if (titleEl) {
            titleEl.textContent = 'Markdown 미리보기';
        }

        updatePreviewContent();
        setPreviewTab(previewState.activeTab || 'render');
    }

    function showImagePreviewPanel(blob, label = '이미지 미리보기') {
        if (previewImageUrl) {
            URL.revokeObjectURL(previewImageUrl);
            previewImageUrl = null;
        }
        previewImageUrl = URL.createObjectURL(blob);

        if (!previewPanel) {
            showPreviewPanel('');
        }

        const titleEl = previewPanel.querySelector('.mdcp-preview-title');
        if (titleEl) {
            titleEl.textContent = label;
        }

        const renderPane = previewPanel.querySelector('[data-pane="render"]');
        renderPane.innerHTML = `<div class="mdcp-preview-image-wrap"><img src="${previewImageUrl}" alt="전체 페이지 캡처"></div>`;
        setPreviewTab('render');
    }

    function setPreviewTab(tabName) {
        previewState.activeTab = tabName;
        const tabs = previewPanel.querySelectorAll('.mdcp-preview-tab');
        const panes = previewPanel.querySelectorAll('.mdcp-preview-pane');

        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
        });

        panes.forEach(pane => {
            pane.classList.toggle('mdcp-preview-pane-hidden', pane.getAttribute('data-pane') !== tabName);
        });
    }

    function updatePreviewContent() {
        if (!previewPanel) return;

        const renderPane = previewPanel.querySelector('[data-pane="render"]');
        const textarea = previewPanel.querySelector('.mdcp-preview-textarea');
        const linksContainer = previewPanel.querySelector('.mdcp-preview-links');

        if (textarea.value !== previewState.markdown) {
            textarea.value = previewState.markdown;
        }
        renderPane.innerHTML = markdownToHtml(previewState.markdown);

        const links = extractLinksFromMarkdown(previewState.markdown).filter(link => link.trim() !== '');
        if (links.length === 0) {
            linksContainer.innerHTML = '<div class="mdcp-preview-empty">링크가 없습니다.</div>';
        } else {
            linksContainer.innerHTML = links.map(link => (
                `<div class="mdcp-preview-link"><a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></div>`
            )).join('');
        }
    }

    /**
     * Get all fixed or sticky elements, traversing Shadow DOM recursively
     */
    function getFixedElements(root) {
        const fixedElements = [];
        // Use try-catch to avoid issues with closed shadow roots or access denial
        try {
            const allElements = root.querySelectorAll('*');
            for (const el of allElements) {
                const style = window.getComputedStyle(el);
                if (style.position === 'fixed' || style.position === 'sticky') {
                    fixedElements.push(el);
                }

                if (el.shadowRoot) {
                    fixedElements.push(...getFixedElements(el.shadowRoot));
                }
            }
        } catch (e) {
            console.warn('Error finding fixed elements:', e);
        }
        return fixedElements;
    }

    /**
     * Capture a specific area of the document using native API
     */
    async function captureArea(x, y, width, height, options = {}) {
        try {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const ratio = window.devicePixelRatio || 1;

            const originalScroll = { x: window.scrollX, y: window.scrollY };

            // Hide fixed/sticky elements to avoid duplication during stitching
            const fixedElements = [];
            if (options.hideFixed !== false) {
                const found = getFixedElements(document.body);
                for (const el of found) {
                    fixedElements.push(el);
                    el.dataset.mdcpHidden = '1';
                    el.style.visibility = 'hidden';
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            const ctx = canvas.getContext('2d');

            const maxX = x + width;
            const maxY = y + height;

            // Loop through the area in viewport-sized chunks
            for (let cy = y; cy < maxY; cy += viewportHeight) {
                for (let cx = x; cx < maxX; cx += viewportWidth) {
                    window.scrollTo(cx, cy);
                    // Wait for render/scroll transparency to settle
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    await new Promise(resolve => setTimeout(resolve, 250)); // Wait for lazy load/render

                    const scrollX = window.scrollX;
                    const scrollY = window.scrollY;

                    const response = await chrome.runtime.sendMessage({ type: 'mdcp-capture-visible' });
                    if (!response || response.error || !response.dataUrl) {
                        console.warn('Capture failed for chunk:', response?.error);
                        continue;
                    }

                    const img = new Image();
                    img.src = response.dataUrl;
                    await new Promise((resolve) => {
                        img.onload = resolve;
                        img.onerror = resolve; // Continue even if image load fails
                    });

                    // Calculate overlap between Viewport and Target Rect
                    const visibleX = Math.max(x, scrollX);
                    const visibleY = Math.max(y, scrollY);
                    const visibleRight = Math.min(maxX, scrollX + viewportWidth);
                    const visibleBottom = Math.min(maxY, scrollY + viewportHeight);

                    const visibleW = visibleRight - visibleX;
                    const visibleH = visibleBottom - visibleY;

                    if (visibleW > 0 && visibleH > 0) {
                        // Source (relative to viewport/image)
                        const sx = visibleX - scrollX;
                        const sy = visibleY - scrollY;

                        // Destination (relative to canvas)
                        const dx = visibleX - x;
                        const dy = visibleY - y;

                        ctx.drawImage(
                            img,
                            sx * ratio, sy * ratio, visibleW * ratio, visibleH * ratio,
                            dx * ratio, dy * ratio, visibleW * ratio, visibleH * ratio
                        );
                    }
                }
            }

            // Restore state
            fixedElements.forEach(el => {
                if (el.dataset.mdcpHidden === '1') {
                    el.style.visibility = '';
                    delete el.dataset.mdcpHidden;
                }
            });
            window.scrollTo(originalScroll.x, originalScroll.y);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            return blob;
        } catch (error) {
            console.error('Capture Area failed:', error);
            return null;
        }
    }

    async function copyMultipleElementsAsImage(elements) {
        try {
            showToast('이미지 생성 중...', floatingButton);

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            elements.forEach(el => {
                const rect = el.getBoundingClientRect();
                const absLeft = rect.left + window.scrollX;
                const absTop = rect.top + window.scrollY;
                minX = Math.min(minX, absLeft);
                minY = Math.min(minY, absTop);
                maxX = Math.max(maxX, absLeft + rect.width);
                maxY = Math.max(maxY, absTop + rect.height);
            });

            // Adjust for padding
            minX = Math.max(0, minX - 10);
            minY = Math.max(0, minY - 10);
            maxX = Math.min(document.documentElement.scrollWidth, maxX + 10);
            maxY = Math.min(document.documentElement.scrollHeight, maxY + 10);

            const width = maxX - minX;
            const height = maxY - minY;

            if (width <= 0 || height <= 0) return false;

            const blob = await captureArea(minX, minY, width, height);
            if (!blob) {
                showToast('✗ 이미지 캡처에 실패했습니다.', floatingButton);
                return false;
            }

            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);

            showToast('✓ 이미지가 클립보드에 복사되었습니다!', floatingButton);
            return true;
        } catch (error) {
            console.error('Failed to copy image to clipboard:', error);
            showToast('✗ 이미지 복사에 실패했습니다.', floatingButton);
            return false;
        }
    }

    /**
     * Copy full page as image
     */
    async function copyFullPageAsImage() {
        try {
            showToast('전체 페이지 이미지 생성 중...', floatingButton);

            const width = Math.max(
                document.documentElement.scrollWidth,
                document.body.scrollWidth,
                document.documentElement.clientWidth
            );
            const height = Math.max(
                document.documentElement.scrollHeight,
                document.body.scrollHeight,
                document.documentElement.clientHeight
            );

            const blob = await captureArea(0, 0, width, height);
            if (!blob) {
                showToast('✗ 전체 페이지 이미지 캡처에 실패했습니다.', floatingButton);
                return false;
            }

            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);

            showToast('✓ 전체 페이지 이미지가 클립보드에 복사되었습니다!', floatingButton);
            return true;
        } catch (error) {
            console.error('Failed to copy full page image:', error);
            showToast('✗ 전체 페이지 이미지 복사에 실패했습니다.', floatingButton);
            return false;
        }
    }

    /**
     * Copy full page as Markdown
     */
    async function copyFullPageAsMarkdown() {
        try {
            showToast('전체 페이지 Markdown 생성 중...', floatingButton);
            const markdown = convertToMarkdown(document.body);
            if (!markdown) {
                showToast('✗ Markdown 변환에 실패했습니다.', floatingButton);
                return false;
            }
            const copied = await copyToClipboard(markdown, null, floatingButton);
            if (!copied) {
                return false;
            }
            return true;
        } catch (error) {
            console.error('Failed to copy full page Markdown:', error);
            showToast('✗ 전체 페이지 Markdown 복사에 실패했습니다.', floatingButton);
            return false;
        }
    }

    /**
     * Copy image to clipboard
     */
    async function copyImageToClipboard(element) {
        return copyMultipleElementsAsImage([element]);
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

    function extractYouTubeMetadata() {
        const title =
            document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
            document.querySelector('h1.title')?.textContent?.trim() ||
            document.querySelector('meta[name="title"]')?.getAttribute('content')?.trim() ||
            document.title?.replace(' - YouTube', '').trim();

        const channel =
            document.querySelector('#owner ytd-channel-name yt-formatted-string')?.textContent?.trim() ||
            document.querySelector('ytd-channel-name a')?.textContent?.trim() ||
            document.querySelector('meta[itemprop="channelId"]')?.getAttribute('content')?.trim() ||
            '';

        const viewCount =
            document.querySelector('span.view-count')?.textContent?.trim() ||
            document.querySelector('meta[itemprop="interactionCount"]')?.getAttribute('content')?.trim() ||
            '';

        const publishedDate =
            document.querySelector('#info-strings yt-formatted-string')?.textContent?.trim() ||
            document.querySelector('meta[itemprop="datePublished"]')?.getAttribute('content')?.trim() ||
            '';

        const url =
            document.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
            window.location.href;

        const lines = [
            title ? `# ${title}` : '',
            url ? `영상 링크: ${url}` : '',
            channel ? `채널명: ${channel}` : '',
            viewCount ? `조회수: ${viewCount}` : '',
            publishedDate ? `게시일: ${publishedDate}` : ''
        ].filter(Boolean);

        return lines.join('\n');
    }

    /**
     * Convert all relative links to absolute links in an element
     */
    function makeLinksAbsolute(element) {
        // Convert <a> href
        element.querySelectorAll('a[href]').forEach(a => {
            // a.href returns the absolute URL in the browser
            const absoluteHref = a.href;
            if (absoluteHref) {
                a.setAttribute('href', absoluteHref);
            }
        });

        // Convert <img> src
        element.querySelectorAll('img[src]').forEach(img => {
            // img.src returns the absolute URL in the browser
            const absoluteSrc = img.src;
            if (absoluteSrc) {
                img.setAttribute('src', absoluteSrc);
            }
        });
    }

    /**
     * Convert HTML element to Markdown
     */
    function convertToMarkdown(element) {
        try {
            if (isYouTubeSite()) {
                const meta = extractYouTubeMetadata();
                if (meta) {
                    return meta;
                }
            }

            // Clone the element to avoid modifying the original
            const clonedElement = element.cloneNode(true);

            // Convert relative links to absolute
            makeLinksAbsolute(clonedElement);

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
            showToast(`${selectedElements.length}개 요소 선택됨 (엔터키로 복사)`, floatingButton);
        } else {
            showToast('영역 내에 요소가 없습니다.', floatingButton);
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
    async function processAndCopy() {
        const elementsToProcess = selectedElements.length > 0 ? selectedElements : (currentElement ? [currentElement] : []);

        if (elementsToProcess.length === 0) {
            showToast('✗ 선택된 요소가 없습니다.', floatingButton);
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

                combinedMarkdown = markdowns.join('\n\n');

                // Copy to clipboard and show preview
                const copied = await copyToClipboard(combinedMarkdown, null, floatingButton);
                if (copied) {
                    showPreviewPanel(combinedMarkdown);
                }
            } else {
                showToast('✗ Markdown 변환에 실패했습니다.', floatingButton);
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
                showToast(`선택 해제됨 (${selectedElements.length}개 선택됨)`, floatingButton);
            } else {
                // Add to selection
                selectedElements.push(currentElement);
                currentElement.classList.add('mdcp-multi-selected');
                showToast(`${selectedElements.length}개 요소 선택됨 (엔터키로 복사)`, floatingButton);
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
                showToast('영역 선택이 취소되었습니다.', floatingButton);
            } else {
                showToast('선택 모드가 취소되었습니다.', floatingButton);
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
                showToast('영역 선택 모드 (드래그하여 영역 선택)', floatingButton);
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
                showToast('영역 선택 모드 종료', floatingButton);
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
        floatingButton.title = '요소 복사 모드 시작\nShift+클릭: 전체 페이지 Markdown\n우클릭: 요소 이미지 복사\nShift+우클릭: 전체 페이지 이미지';
        document.body.appendChild(floatingButton);

        // Restore last position from chrome.storage when available
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
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

        if (event.shiftKey) {
            copyFullPageAsMarkdown();
            return;
        }

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

        if (event.shiftKey) {
            copyFullPageAsImage();
            return;
        }

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

            // Save button position to chrome.storage when available
            if (wasDragged && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
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
            showToast('선택 모드가 이미 활성화되어 있습니다.', floatingButton);
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
        showToast(`요소를 클릭하여 선택하세요 (Alt+드래그: 영역 선택, Enter: 복사, ESC: 취소)`, floatingButton);
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
            floatingButton.title = '요소 복사 모드 시작\nShift+클릭: 전체 페이지 Markdown\n우클릭: 요소 이미지 복사\nShift+우클릭: 전체 페이지 이미지';
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

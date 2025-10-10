/**
 * @file main.js
 * @description Core Javascript for the Story Weaver application.
 * This file handles user interactions for the workspace, project view, and invite pages.
 * It manages state, handles API communications for creating projects, notes, and AI-generated content,
 * and dynamically renders UI components.
 * @version 2.2.0 (Bugfix for note submission)
 */

document.addEventListener('DOMContentLoaded', () => {

    // =================================================================================
    // --- 🏛️ CONSTANTS & GLOBAL STATE ---
    // =================================================================================

    const jsData = document.getElementById('js-data');
    const config = {
        projectId: jsData?.dataset.projectId,
        projectName: jsData?.dataset.projectName,
        isAtlas: jsData?.dataset.isAtlas === 'True',
        inviteToken: jsData?.dataset.inviteToken,
    };

    // Determine the current view to attach specific event listeners
    const isWorkspaceView = !!document.getElementById('new-project-form');
    const isProjectView = !!document.getElementById('project-notes') && !!config.projectId;
    const isInviteView = !!document.getElementById('invite-note-form') && !!config.inviteToken;

    // --- State for dynamic UI elements ---
    let projectViewState = {
        currentPage: 1,
        isLoading: false,
        hasMorePages: true,
        searchDebounceTimer: null,
    };

    let modalState = {
        activeAIAction: null,
        quizGenerationOptions: {},
        selectedNotes: [], // Holds full note objects for API calls
        noteSelectionCandidates: new Map(), // Caches notes for the selection modal
        previewState: {
            searchQuery: '',
            selectedTags: [],
            currentPage: 1,
            totalPages: 1,
            searchType: 'vector'
        },
    };

    // =================================================================================
    // --- 🚀 APP INITIALIZATION ---
    // =================================================================================

    /**
     * Initializes the application by setting up listeners based on the current page.
     */
    function initializePage() {
        if (isWorkspaceView) setupWorkspaceViewListeners();
        if (isProjectView) setupProjectViewListeners();
        if (isInviteView) setupInviteViewListeners();
        setupGlobalListeners();
    }

    // =================================================================================
    // --- 🎧 EVENT LISTENER SETUP ---
    // =================================================================================

    function setupWorkspaceViewListeners() {
        document.getElementById('new-project-form')?.addEventListener('submit', handleNewProjectSubmit);
    }

    function setupProjectViewListeners() {
        // --- Forms ---
        document.getElementById('note-form')?.addEventListener('submit', handleNoteFormSubmit);
        document.getElementById('token-form')?.addEventListener('submit', handleTokenFormSubmit);
        document.getElementById('shared-token-form')?.addEventListener('submit', handleSharedTokenSubmit);
        document.getElementById('generate-notes-form')?.addEventListener('submit', handleGenerateNotesSubmit);

        // --- Buttons & Inputs ---
        document.getElementById('suggest-tags-btn')?.addEventListener('click', handleSuggestTags);
        document.getElementById('contributor-filter')?.addEventListener('change', () => fetchNotes(true));
        document.getElementById('note-image-upload')?.addEventListener('change', handleFileUpload);
        document.getElementById('tag-suggestions-container')?.addEventListener('click', handleTagSuggestionClick);

        // --- AI Action Launchers ---
        document.getElementById('launch-story-builder-btn')?.addEventListener('click', () => launchAIAction('generate-story', 'Select Notes to Weave a Story'));
        document.getElementById('launch-study-guide-btn')?.addEventListener('click', () => launchAIAction('generate-study-guide', 'Select Notes for Study Guide'));
        document.getElementById('quiz-options-form')?.addEventListener('submit', handleQuizOptionsSubmit);

        // --- Note Selection Modal ---
        document.getElementById('confirm-action-btn')?.addEventListener('click', handleConfirmAIAction);
        document.getElementById('preview-notes-container')?.addEventListener('change', handleNoteCheckboxChange);
        document.getElementById('preview-search-input')?.addEventListener('input', handlePreviewSearchInput);
        document.getElementById('preview-tags-container')?.addEventListener('change', handlePreviewTagFilterChange);
        document.getElementById('preview-pagination-container')?.addEventListener('click', handlePreviewPaginationClick);
        document.getElementById('preview-search-type')?.addEventListener('change', handlePreviewSearchTypeChange);
        document.getElementById('select-all-notes-btn')?.addEventListener('click', handleSelectAllNotes);
        document.getElementById('deselect-all-notes-btn')?.addEventListener('click', handleDeselectAllNotes);

        // --- Initial Data Load & Infinite Scroll ---
        populateContributors();
        fetchNotes();
        window.addEventListener('scroll', handleInfiniteScroll);
    }

    function setupInviteViewListeners() {
        document.getElementById('invite-note-form')?.addEventListener('submit', handleInviteNoteSubmit);
        document.getElementById('follow-up-list')?.addEventListener('click', handleFollowUpClick);
    }

    function setupGlobalListeners() {
        // --- Modal Triggers ---
        document.querySelectorAll('[data-modal-target]').forEach(trigger => {
            trigger.addEventListener('click', () => document.getElementById(trigger.dataset.modalTarget)?.classList.remove('hidden'));
        });
        document.querySelectorAll('.modal-close-btn').forEach(button => {
            button.addEventListener('click', () => button.closest('.fixed.inset-0')?.classList.add('hidden'));
        });

        // --- Delegated Clipboard Buttons ---
        document.body.addEventListener('click', handleClipboardButtonClick);
    }


    // =================================================================================
    // --- 📡 API & DATA FETCHING ---
    // =================================================================================

    /**
     * A generic wrapper for the Fetch API to handle common tasks.
     * @param {string} url - The URL to fetch.
     * @param {object} options - Fetch options (method, headers, body).
     * @returns {Promise<object>} - The JSON response from the server.
     * @throws {Error} - Throws an error with a user-friendly message if the request fails.
     */
    async function apiFetch(url, options = {}) {
        options.headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || data.error || 'An unknown API error occurred.');
            }
            return data;
        } catch (error) {
            console.error(`API Fetch Error (${url}):`, error);
            // Re-throw with a cleaner message for the UI handler
            throw new Error(error.message);
        }
    }

    /**
     * Fetches notes for the current project with pagination for infinite scroll.
     * @param {boolean} isNewFilter - If true, resets pagination and clears existing notes.
     */
    async function fetchNotes(isNewFilter = false) {
        const {
            isLoading,
            hasMorePages
        } = projectViewState;
        if (isLoading || (!hasMorePages && !isNewFilter)) return;

        projectViewState.isLoading = true;
        const notesContainer = document.getElementById('notes-container');
        const loadingIndicator = document.getElementById('loading-indicator');

        if (isNewFilter) {
            projectViewState.currentPage = 1;
            projectViewState.hasMorePages = true;
            if (notesContainer) notesContainer.innerHTML = '';
        }
        loadingIndicator?.classList.remove('hidden');

        try {
            const contributorFilter = document.getElementById('contributor-filter').value;
            const response = await fetch(`/api/notes/${config.projectId}?page=${projectViewState.currentPage}&contributor_filter=${contributorFilter}`);
            if (!response.ok) throw new Error('Failed to fetch notes');
            const newNotes = await response.json();

            if (newNotes.length > 0) {
                newNotes.forEach(note => renderNote(note));
                projectViewState.currentPage++;
            } else {
                projectViewState.hasMorePages = false;
                if (projectViewState.currentPage === 1 && notesContainer?.innerHTML === '') {
                    // FIX: Add a specific class to target for removal later
                    notesContainer.innerHTML = `<p class="no-notes-message text-slate-500 text-center col-span-full py-8">No notes found for this filter.</p>`;
                }
            }
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            projectViewState.isLoading = false;
            loadingIndicator?.classList.add('hidden');
        }
    }

    /**
     * Fetches and renders notes inside the Note Selection modal based on search/filter criteria.
     */
    async function fetchAndRenderPreviewNotes() {
        const {
            searchQuery,
            selectedTags,
            currentPage,
            searchType
        } = modalState.previewState;
        const params = new URLSearchParams({
            page: currentPage,
            q: searchQuery,
            tags: selectedTags.join(',')
        });
        if (config.isAtlas) params.append('search_type', searchType);

        const previewNotesContainer = document.getElementById('preview-notes-container');
        previewNotesContainer.innerHTML = '<div class="spinner mx-auto my-4"></div>'; // Show loader

        try {
            const data = await apiFetch(`/api/search-notes/${config.projectId}?${params.toString()}`);
            modalState.previewState.totalPages = data.total_pages;

            previewNotesContainer.innerHTML = '';
            if (data.notes.length === 0) {
                previewNotesContainer.innerHTML = '<p class="text-slate-500 p-4">No notes found.</p>';
            }
            data.notes.forEach(note => {
                modalState.noteSelectionCandidates.set(note._id, note);
                previewNotesContainer.appendChild(createPreviewNoteElement(note));
            });
            renderPagination();
            document.getElementById('preview-results-summary').textContent = `Showing page ${modalState.previewState.currentPage} of ${modalState.previewState.totalPages || 1}. (${data.total_notes} total)`;
        } catch (error) {
            previewNotesContainer.innerHTML = `<p class="text-red-500 p-4">Error: ${error.message}</p>`;
        }
    }

    // =================================================================================
    // --- 📥 EVENT HANDLERS ---
    // =================================================================================

    // --- Form Submissions ---
    async function handleNewProjectSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const name = form.querySelector('#project-name-input').value.trim();
        const project_goal = form.querySelector('#project-goal-input').value.trim();
        const project_type = form.querySelector('#project-type-select').value;
        if (!name || !project_goal) return showToast('Project name and goal are required.', 'error');

        try {
            const data = await apiFetch('/api/projects', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    project_goal,
                    project_type
                })
            });
            if (data.status === 'success') {
                window.location.href = `/project/${data.project._id}`;
            }
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    async function handleNoteFormSubmit(e) {
        e.preventDefault();
        const contentEl = document.getElementById('note-content');
        const content = contentEl.value.trim();
        if (!content) return;

        const tags = document.getElementById('note-tags-input')?.value || '';
        try {
            const result = await apiFetch('/api/notes', {
                method: 'POST',
                body: JSON.stringify({
                    content,
                    project_id: config.projectId,
                    tags
                })
            });
            contentEl.value = '';
            document.getElementById('note-tags-input').value = '';
            document.getElementById('tag-suggestions-container').innerHTML = '';
            
            // FIX: Only remove the "No notes" message, don't clear all notes.
            const noNotesMessage = document.querySelector('#notes-container .no-notes-message');
            if (noNotesMessage) {
                noNotesMessage.remove();
            }
            
            renderNote(result.note, true); // Prepend the new note
        } catch (error) {
            showToast(error.message, 'error');
        }
    }
    
    async function handleTokenFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const label = form.querySelector('#contributor-label-input').value.trim();
        const prompt = form.querySelector('#prompt-textarea').value.trim();

        if (!label || !prompt) return showToast("Contributor name and prompt are required.", 'error');

        setButtonLoading(submitBtn, 'Generating...');
        try {
            const data = await apiFetch('/api/generate-token', {
                method: 'POST',
                body: JSON.stringify({
                    label,
                    prompt,
                    project_id: config.projectId
                })
            });
            renderTokenResult(document.getElementById('token-result'), data.label, data.invite_url);
            form.reset();
        } catch (error) {
            document.getElementById('token-result').innerHTML = `<p class="text-red-600">${error.message}</p>`;
        } finally {
            setButtonActive(submitBtn, 'Generate Invite Link');
        }
    }

    async function handleSharedTokenSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const prompt = form.querySelector('#shared-prompt-textarea').value.trim();
        if (!prompt) return showToast("Please provide a prompt for the group.", 'error');

        setButtonLoading(submitBtn, 'Generating...');
        try {
            const data = await apiFetch('/api/generate-shared-token', {
                method: 'POST',
                body: JSON.stringify({
                    prompt,
                    project_id: config.projectId
                })
            });
            renderTokenResult(document.getElementById('shared-token-result'), "Anyone", data.shared_url);
            form.reset();
        } catch (error) {
            document.getElementById('shared-token-result').innerHTML = `<p class="text-red-600">${error.message}</p>`;
        } finally {
            setButtonActive(submitBtn, 'Generate Share Link');
        }
    }

    async function handleGenerateNotesSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const topicInput = form.querySelector('#note-topic-input');
        const submitBtn = form.querySelector('button[type="submit"]');
        const topic = topicInput.value.trim();
        if (!topic) return showToast('Please enter a topic to generate notes for.', 'error');

        setButtonLoading(submitBtn, 'Generating...');
        try {
            const data = await apiFetch('/api/generate-notes', {
                method: 'POST',
                body: JSON.stringify({
                    project_id: config.projectId,
                    topic
                })
            });

            if (data.notes && data.notes.length > 0) {
                const notesContainer = document.getElementById('notes-container');
                const noNotesMessage = notesContainer.querySelector('.no-notes-message');
                if (noNotesMessage) noNotesMessage.remove();

                data.notes.reverse().forEach(note => renderNote(note, true));
                topicInput.value = '';
                showToast(`${data.notes.length} notes generated for "${topic}".`, 'success');
            } else {
                showToast('The AI could not generate notes. Please try a different topic.', 'error');
            }
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setButtonActive(submitBtn, 'Generate Notes');
        }
    }

    async function handleInviteNoteSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const contentEl = form.querySelector('#note-content');
        if (!contentEl.value.trim()) return showToast('Please share your thoughts before submitting.', 'error');

        setButtonLoading(submitBtn);
        try {
            const data = await apiFetch('/api/notes', {
                method: 'POST',
                body: JSON.stringify({
                    content: contentEl.value.trim(),
                    project_id: config.projectId,
                    invite_token: config.inviteToken,
                    active_prompt: jsData.dataset.activePrompt
                })
            });
            contentEl.value = '';
            renderFollowUps(data.new_follow_ups);
            showToast('Your note has been submitted successfully!', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setButtonActive(submitBtn, 'Add Note');
        }
    }


    // --- AI Modal & Interaction Handlers ---

    function handleQuizOptionsSubmit(e) {
        e.preventDefault();
        modalState.quizGenerationOptions = {
            num_questions: document.getElementById('quiz-num-questions').value,
            question_type: document.getElementById('quiz-question-type').value,
            difficulty: document.getElementById('quiz-difficulty').value,
            knowledge_source: document.querySelector('input[name="knowledge_source"]:checked').value,
        };
        document.getElementById('quiz-options-modal').classList.add('hidden');
        launchAIAction('generate-quiz', 'Select Notes for Quiz');
    }

    function handleConfirmAIAction() {
        if (modalState.selectedNotes.length === 0) {
            return showToast("Please select at least one note.", 'error');
        }
        const actionMap = {
            'generate-quiz': handleGenerateQuiz,
            'generate-story': handleGenerateStory,
            'generate-study-guide': handleGenerateStudyGuide,
        };
        const action = actionMap[modalState.activeAIAction];
        if (action) action();
    }

    async function handleGenerateQuiz() {
        const quizTitle = prompt("Enter a title for your new quiz:", "Practice Quiz");
        if (!quizTitle) return;

        const confirmBtn = document.getElementById('confirm-action-btn');
        setButtonLoading(confirmBtn, 'Generating...');

        try {
            await apiFetch('/api/generate-quiz', {
                method: 'POST',
                body: JSON.stringify({
                    notes: modalState.selectedNotes.map(n => ({
                        _id: n._id,
                        content: n.content
                    })),
                    title: quizTitle,
                    ...modalState.quizGenerationOptions
                }),
            });
            document.getElementById('note-selection-modal').classList.add('hidden');
            showToast('Quiz generated! Reloading page...', 'success');
            setTimeout(() => window.location.reload(), 2000);
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setButtonActive(confirmBtn, 'Confirm Selection');
        }
    }

    async function handleGenerateStory() {
        const selectedTone = document.getElementById('story-tone-select').value;
        const confirmBtn = document.getElementById('confirm-action-btn');
        setButtonLoading(confirmBtn, 'Weaving...');

        try {
            const data = await apiFetch('/api/generate-story', {
                method: 'POST',
                body: JSON.stringify({
                    project_name: config.projectName,
                    tone: selectedTone,
                    notes: modalState.selectedNotes
                })
            });
            document.getElementById('note-selection-modal').classList.add('hidden');
            document.getElementById('story-modal-title').textContent = `Your Story: ${config.projectName}`;
            document.getElementById('story-modal-content').innerHTML = `<div class="prose max-w-none">${sanitizeHTML(data.story).replace(/\n/g, '<br>')}</div>`;
            document.getElementById('story-modal').classList.remove('hidden');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setButtonActive(confirmBtn, 'Confirm Selection');
        }
    }

    async function handleGenerateStudyGuide() {
        const confirmBtn = document.getElementById('confirm-action-btn');
        setButtonLoading(confirmBtn, 'Generating...');

        try {
            const data = await apiFetch('/api/generate-study-guide', {
                method: 'POST',
                body: JSON.stringify({
                    project_name: config.projectName,
                    notes: modalState.selectedNotes
                })
            });
            document.getElementById('note-selection-modal').classList.add('hidden');
            document.getElementById('study-guide-modal-content').innerHTML = convertMarkdownToHtml(data.study_guide);
            document.getElementById('study-guide-modal').classList.remove('hidden');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setButtonActive(confirmBtn, 'Confirm Selection');
        }
    }

    // --- Other UI Interaction Handlers ---
    function handleInfiniteScroll() {
        if (!projectViewState.isLoading && projectViewState.hasMorePages && (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
            fetchNotes();
        }
    }

    function handleFollowUpClick(e) {
        if (e.target.tagName === 'LI') {
            const newPrompt = e.target.textContent;
            const noteContentTextarea = document.getElementById('note-content');
            jsData.dataset.activePrompt = newPrompt;
            document.getElementById('active-prompt-display').textContent = newPrompt;
            noteContentTextarea.focus();
            noteContentTextarea.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }

    async function handleClipboardButtonClick(e) {
        const button = e.target.closest('.copy-link-btn');
        if (button && button.dataset.url) {
            const url = button.dataset.url;
            const originalText = button.textContent;
            try {
                await navigator.clipboard.writeText(url);
                setButtonLoading(button, 'Copied!');
            } catch (err) {
                console.error('Failed to copy link:', err);
                showToast('Could not copy link.', 'error');
            } finally {
                setTimeout(() => setButtonActive(button, originalText), 2000);
            }
        }
    }

    async function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const noteContentTextarea = document.getElementById('note-content');
        const spinner = document.getElementById('file-processing-spinner');
        spinner.classList.remove('hidden');

        const formData = new FormData();
        formData.append('document', file);

        try {
            const response = await fetch('/api/process-document', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to process file.');

            const existingText = noteContentTextarea.value.trim();
            noteContentTextarea.value = existingText ? `${existingText}\n\n---\n\n${data.extracted_text}` : data.extracted_text;

        } catch (error) {
            showToast(`Error processing file: ${error.message}`, 'error');
        } finally {
            spinner.classList.add('hidden');
            e.target.value = ''; // Reset file input
        }
    }

    // --- Note Selection Modal Handlers ---

    function handlePreviewSearchInput(e) {
        clearTimeout(projectViewState.searchDebounceTimer);
        projectViewState.searchDebounceTimer = setTimeout(() => {
            modalState.previewState.searchQuery = e.target.value;
            modalState.previewState.currentPage = 1;
            fetchAndRenderPreviewNotes();
        }, 400);
    }

    function handlePreviewTagFilterChange() {
        modalState.previewState.selectedTags = Array.from(document.querySelectorAll('#preview-tags-container .tag-checkbox:checked')).map(cb => cb.value);
        modalState.previewState.currentPage = 1;
        fetchAndRenderPreviewNotes();
    }

    function handlePreviewPaginationClick(e) {
        const button = e.target.closest('.pagination-btn');
        if (button && !button.disabled) {
            modalState.previewState.currentPage = parseInt(button.dataset.page, 10);
            fetchAndRenderPreviewNotes();
        }
    }

    function handlePreviewSearchTypeChange(e) {
        modalState.previewState.searchType = e.target.value;
        modalState.previewState.currentPage = 1;
        fetchAndRenderPreviewNotes();
    }

    function handleNoteCheckboxChange(e) {
        if (e.target.matches('.note-preview-checkbox')) {
            const noteId = e.target.dataset.noteId;
            const fullNote = modalState.noteSelectionCandidates.get(noteId);
            if (!fullNote) return;

            if (e.target.checked) {
                if (!modalState.selectedNotes.some(n => n._id === noteId)) {
                    modalState.selectedNotes.push(fullNote);
                }
            } else {
                modalState.selectedNotes = modalState.selectedNotes.filter(n => n._id !== noteId);
            }
            updateSelectedNotesUI();
        }
    }

    function handleTagSuggestionClick(e) {
        if (e.target.matches('.tag-suggestion')) {
            addTagToInput(e.target.textContent);
        }
    }
    
    /**
     * Selects all notes currently visible in the preview pane.
     */
    function handleSelectAllNotes() {
        // Add all candidates from the current view to the selection
        modalState.noteSelectionCandidates.forEach((note, noteId) => {
            if (!modalState.selectedNotes.some(n => n._id === noteId)) {
                modalState.selectedNotes.push(note);
            }
        });

        // Visually check all the checkboxes
        document.querySelectorAll('#preview-notes-container .note-preview-checkbox').forEach(checkbox => {
            checkbox.checked = true;
        });

        updateSelectedNotesUI();
    }
    
    /**
     * Deselects all currently selected notes.
     */
    function handleDeselectAllNotes() {
        // Clear the selection array
        modalState.selectedNotes = [];

        // Visually uncheck all the checkboxes
        document.querySelectorAll('#preview-notes-container .note-preview-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });

        updateSelectedNotesUI();
    }

    // =================================================================================
    // --- 🎨 UI RENDERING & HELPERS ---
    // =================================================================================

    /**
     * Renders a single note card into the main notes container.
     * @param {object} note - The note object from the API.
     * @param {boolean} prepend - If true, adds the note to the top of the list.
     */
    function renderNote(note, prepend = false) {
        const notesContainer = document.getElementById('notes-container');
        if (!notesContainer) return;

        const noteCard = document.createElement('div');
        noteCard.className = 'note-card';
        const tagsHTML = note.tags?.length > 0 ? note.tags.map(t => `<span class="tag">${sanitizeHTML(t)}</span>`).join('') : '';
        const formattedContent = sanitizeHTML(note.content).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

        noteCard.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="contributor-tag">${sanitizeHTML(note.contributor_label)}</span>
                ${tagsHTML}
            </div>
            <p class="note-timestamp">${note.formatted_timestamp}</p>
            <div class="note-content">${formattedContent}</div>`;

        if (prepend) {
            notesContainer.prepend(noteCard);
        } else {
            notesContainer.appendChild(noteCard);
        }
    }

    /**
     * Renders a link result in the UI after token generation.
     * @param {HTMLElement} resultDiv - The container to render the result into.
     * @param {string} label - The label for the person/group.
     * @param {string} url - The URL to be shared.
     */
    function renderTokenResult(resultDiv, label, url) {
        const withWhom = label === "Anyone" ? "Anyone with this link can contribute:" : `Share this unique link with ${sanitizeHTML(label)}:`;
        resultDiv.innerHTML = `
            <p class="text-sm font-medium text-slate-700 mb-2">${withWhom}</p>
            <div class="flex items-center space-x-2">
                <input type="text" value="${url}" readonly class="form-input flex-grow bg-slate-100">
                <button type="button" class="btn btn-secondary flex-shrink-0 copy-link-btn" data-url="${url}">Copy</button>
            </div>`;
    }

    /**
     * Creates and returns a DOM element for a note in the selection modal.
     * @param {object} note - The note object.
     * @returns {HTMLElement} - The created div element.
     */
    function createPreviewNoteElement(note) {
        const isSelected = modalState.selectedNotes.some(n => n._id === note._id);
        const element = document.createElement('div');
        element.className = 'p-3 border rounded-md bg-white flex items-start space-x-3 transition-colors hover:bg-slate-50 cursor-pointer';
        element.dataset.noteId = note._id;

        const contentPreview = note.content.substring(0, 150) + (note.content.length > 150 ? '...' : '');

        element.innerHTML = `
            <input type="checkbox" data-note-id="${note._id}" class="note-preview-checkbox mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 pointer-events-none" ${isSelected ? 'checked' : ''}>
            <div class="flex-1">
                <label class="block text-xs font-bold text-slate-500">${sanitizeHTML(note.contributor_label)}</label>
                <p class="text-sm text-slate-800">${sanitizeHTML(contentPreview)}</p>
            </div>`;

        element.addEventListener('click', () => {
            const checkbox = element.querySelector('.note-preview-checkbox');
            checkbox.checked = !checkbox.checked;
            // Manually dispatch a change event
            checkbox.dispatchEvent(new Event('change', {
                bubbles: true
            }));
        });

        return element;
    }

    /** Renders pagination controls for the note selection modal. */
    function renderPagination() {
        const {
            currentPage,
            totalPages
        } = modalState.previewState;
        const container = document.getElementById('preview-pagination-container');
        if (!container) return;
        container.innerHTML = `
            <button class="pagination-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
            <span class="text-sm text-slate-600">Page ${currentPage} of ${totalPages || 1}</span>
            <button class="pagination-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>`;
    }

    /** Updates the UI that shows which notes are currently selected. */
    function updateSelectedNotesUI() {
        const countEl = document.getElementById('selected-notes-count');
        const containerEl = document.getElementById('selected-notes-container');
        if (!countEl || !containerEl) return;

        const count = modalState.selectedNotes.length;
        countEl.textContent = count;
        document.getElementById('confirm-action-btn').disabled = count === 0;

        containerEl.innerHTML = '';
        modalState.selectedNotes.forEach(note => {
            const noteDiv = document.createElement('div');
            noteDiv.className = 'p-2 border text-sm bg-white rounded shadow-sm animate-fade-in';
            noteDiv.textContent = note.content.substring(0, 70) + (note.content.length > 70 ? '...' : '');
            containerEl.appendChild(noteDiv);
        });
    }

    /** Renders AI-suggested follow-up questions on the invite page. */
    function renderFollowUps(questions) {
        const container = document.getElementById('follow-up-container');
        const list = document.getElementById('follow-up-list');
        if (!container || !list) return;

        list.innerHTML = '';
        if (questions && questions.length > 0) {
            questions.forEach(q => {
                const li = document.createElement('li');
                li.className = 'p-4 bg-indigo-50/80 text-indigo-800 rounded-lg cursor-pointer hover:bg-indigo-100 transition-all duration-200 ease-in-out transform hover:scale-[1.02]';
                li.textContent = q;
                list.appendChild(li);
            });
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
        }
    }


    // =================================================================================
    // --- 🛠️ UTILITY & HELPER FUNCTIONS ---
    // =================================================================================

    /**
     * Resets state and opens the note selection modal for an AI action.
     * @param {string} action - The AI action identifier (e.g., 'generate-story').
     * @param {string} title - The title to display on the modal.
     */
    function launchAIAction(action, title) {
        modalState.activeAIAction = action;
        modalState.selectedNotes = [];
        modalState.noteSelectionCandidates.clear();
        modalState.previewState = {
            searchQuery: '',
            selectedTags: [],
            currentPage: 1,
            totalPages: 1,
            searchType: 'vector'
        };

        document.getElementById('note-selection-title').textContent = title;
        document.getElementById('preview-search-input').value = '';
        document.getElementById('preview-search-type').value = 'vector';
        document.getElementById('search-type-selector-container')?.classList.toggle('hidden', !config.isAtlas);

        updateSelectedNotesUI();
        fetchAndRenderTagsForModal();
        fetchAndRenderPreviewNotes();
        document.getElementById('note-selection-modal').classList.remove('hidden');
    }

    /** Fetches and populates the contributor filter dropdown. */
    async function populateContributors() {
        const filterEl = document.getElementById('contributor-filter');
        if (!filterEl) return;
        try {
            const contributors = await apiFetch(`/api/contributors/${config.projectId}`);
            filterEl.innerHTML = contributors.map(c => `<option value="${c}">${c}</option>`).join('');
        } catch (error) {
            console.error('Failed to populate contributors:', error);
        }
    }

    /** Fetches and renders tags for the filter section in the note selection modal. */
    async function fetchAndRenderTagsForModal() {
        const container = document.getElementById('preview-tags-container');
        if (!container) return;
        try {
            const tags = await apiFetch(`/api/get-tags/${config.projectId}`);
            container.innerHTML = tags.map(tag => `<label class="flex items-center space-x-2 cursor-pointer p-1 rounded hover:bg-indigo-50"><input type="checkbox" class="tag-checkbox" value="${tag}"><span>${tag}</span></label>`).join('');
        } catch (error) {
            console.error('Failed to fetch tags:', error);
        }
    }

    /** Handles the click of the "Suggest Tags" button. */
    async function handleSuggestTags() {
        const content = document.getElementById('note-content').value.trim();
        const btn = document.getElementById('suggest-tags-btn');
        const container = document.getElementById('tag-suggestions-container');
        if (!content) return showToast('Please write a note first.', 'error');

        setButtonLoading(btn, '...');
        container.innerHTML = `<p class="text-slate-500 text-sm">AI is thinking...</p>`;
        try {
            const data = await apiFetch('/api/suggest-tags', {
                method: 'POST',
                body: JSON.stringify({
                    content,
                    project_id: config.projectId
                })
            });
            container.innerHTML = '';
            data.tags.forEach(tag => {
                const tagEl = document.createElement('button');
                tagEl.type = 'button';
                tagEl.className = 'tag-suggestion';
                tagEl.textContent = tag;
                container.appendChild(tagEl);
            });
        } catch (error) {
            showToast(error.message, 'error');
            container.innerHTML = '';
        } finally {
            setButtonActive(btn, 'Suggest');
        }
    }

    /** Adds a tag to the tag input field, avoiding duplicates. */
    function addTagToInput(tagToAdd) {
        const tagsInput = document.getElementById('note-tags-input');
        const currentTags = new Set(tagsInput.value.split(',').map(t => t.trim()).filter(Boolean));
        currentTags.add(tagToAdd);
        tagsInput.value = Array.from(currentTags).join(', ');
    }

    /** Displays a toast notification to the user. */
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        const typeClasses = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            info: 'bg-blue-500'
        };
        toast.className = `fixed bottom-5 right-5 text-white py-3 px-6 rounded-lg shadow-xl transition-all duration-300 transform translate-y-16 opacity-0 ${typeClasses[type]}`;
        toast.textContent = message;

        // Create a global container for toasts if it doesn't exist
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            document.body.appendChild(toastContainer);
        }
        toastContainer.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.classList.remove('translate-y-16', 'opacity-0');
            toast.classList.add('translate-y-0', 'opacity-100');
        }, 100);

        // Animate out and remove
        setTimeout(() => {
            toast.classList.remove('translate-y-0', 'opacity-100');
            toast.classList.add('translate-y-16', 'opacity-0');
            toast.addEventListener('transitionend', () => toast.remove());
        }, 4000);
    }

    /** Sanitizes a string to prevent XSS. */
    function sanitizeHTML(str) {
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    /**
     * Converts a string of Markdown into safe HTML.
     * @param {string} markdown - The markdown text.
     * @returns {string} - The resulting HTML string.
     */
    function convertMarkdownToHtml(markdown) {
        let html = sanitizeHTML(markdown);

        // Headers (h1, h2, h3)
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Bold and Italic
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');

        // Unordered Lists
        html = html.replace(/^- (.*(?:\n- .*)*)/gim, (match) => {
            const items = match.split('\n- ').map(item => `<li>${item.replace(/^- /, '')}</li>`).join('');
            return `<ul>${items}</ul>`;
        });

        // Replace newlines with <br> tags, but not inside block elements like lists
        html = html.replace(/<\/ul>\n/g, '</ul>').replace(/\n/g, '<br>');

        return `<div class="prose max-w-none">${html}</div>`;
    }

    /** Puts a button into a loading state. */
    function setButtonLoading(button, text = 'Loading...') {
        if (button) {
            button.disabled = true;
            button.innerHTML = `<span class="spinner-sm"></span> ${text}`;
        }
    }
    
    /** Restores a button to its active state. */
    function setButtonActive(button, text) {
        if (button) {
            button.disabled = false;
            button.innerHTML = text;
        }
    }


    // =================================================================================
    // --- ▶️ RUN INITIALIZATION ---
    // =================================================================================

    initializePage();
});
document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBAL STATE & CONSTANTS ---
    const jsData = document.getElementById('js-data');
    const projectId = jsData?.dataset.projectId;
    const projectName = jsData?.dataset.projectName;
    const isAtlas = jsData?.dataset.isAtlas === 'True';

    // Determine current page/view to attach correct listeners
    const isWorkspaceView = !!document.getElementById('new-project-form');
    const isProjectView = !!document.getElementById('project-notes') && !!projectId;
    const isInviteView = !!document.getElementById('invite-note-form'); // Assuming you add this ID
    
    // State for project view
    let currentPage = 1;
    let isLoading = false;
    let hasMorePages = true;
    let searchDebounceTimer;
    
    // State for modals and AI actions
    let activeAIAction = null;
    let quizGenerationOptions = {};
    let selectedNotes = []; // Holds full note objects for API calls
    let noteSelectionCandidates = new Map(); // Caches notes for the selection modal
    let previewState = { searchQuery: '', selectedTags: [], currentPage: 1, totalPages: 1, searchType: 'vector' };

    // --- CORE LOGIC ---

    function initializePage() {
        if (isWorkspaceView) {
            setupWorkspaceView();
        }
        if (isProjectView) {
            setupProjectView();
        }
        if (isInviteView) {
            // Setup for invite page if needed
        }
        setupGlobalListeners();
    }

    // --- VIEW-SPECIFIC SETUP ---

    function setupWorkspaceView() {
        const newProjectForm = document.getElementById('new-project-form');
        newProjectForm?.addEventListener('submit', handleNewProjectSubmit);
    }
    function setupProjectView() {
        // AI Action Launchers
        document.getElementById('launch-story-builder-btn')?.addEventListener('click', () => {
            activeAIAction = 'generate-story';
            resetAndOpenNoteSelector('Select Notes to Weave a Story');
        });

        document.getElementById('launch-search-btn')?.addEventListener('click', () => {
            activeAIAction = null; // No action, just searching
            resetAndOpenNoteSelector('Search & Manage Notes');
        });

        const quizOptionsForm = document.getElementById('quiz-options-form');
        quizOptionsForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            activeAIAction = 'generate-quiz';
            quizGenerationOptions = {
                num_questions: document.getElementById('quiz-num-questions').value,
                question_type: document.getElementById('quiz-question-type').value,
                difficulty: document.getElementById('quiz-difficulty').value,
                knowledge_source: document.querySelector('input[name="knowledge_source"]:checked').value,
            };
            document.getElementById('quiz-options-modal').classList.add('hidden');
            resetAndOpenNoteSelector('Select Notes for Quiz');
        });

        // Note & Token Forms
        document.getElementById('note-form')?.addEventListener('submit', handleNoteFormSubmit);
        document.getElementById('token-form')?.addEventListener('submit', handleTokenFormSubmit);
        document.getElementById('generate-notes-form')?.addEventListener('submit', handleGenerateNotesSubmit);
        document.getElementById('suggest-tags-btn')?.addEventListener('click', handleSuggestTags);
        document.getElementById('contributor-filter')?.addEventListener('change', () => fetchNotes(true));

        // Note Selection Modal Logic
        document.getElementById('confirm-action-btn')?.addEventListener('click', handleConfirmAction);
        const previewNotesContainer = document.getElementById('preview-notes-container');
        previewNotesContainer?.addEventListener('change', handleNoteCheckboxChange);
        document.getElementById('preview-search-input')?.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                previewState.searchQuery = e.target.value;
                previewState.currentPage = 1;
                fetchAndRenderPreviewNotes();
            }, 500);
        });
        document.getElementById('preview-tags-container')?.addEventListener('change', () => {
            previewState.selectedTags = Array.from(document.querySelectorAll('#preview-tags-container .tag-checkbox:checked')).map(cb => cb.value);
            previewState.currentPage = 1;
            fetchAndRenderPreviewNotes();
        });
        document.getElementById('preview-pagination-container')?.addEventListener('click', (e) => {
            if (e.target.matches('.pagination-btn') && !e.target.disabled) {
                previewState.currentPage = parseInt(e.target.dataset.page, 10);
                fetchAndRenderPreviewNotes();
            }
        });
        
        document.getElementById('preview-search-type')?.addEventListener('change', (e) => {
            previewState.searchType = e.target.value;
            previewState.currentPage = 1;
            fetchAndRenderPreviewNotes(); // Re-fetch notes with the new search type
        });

        // Initial data load for project page
        populateContributors();
        fetchNotes();
        window.addEventListener('scroll', () => {
            if (!isLoading && hasMorePages && (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
                fetchNotes();
            }
        });
    }

    function setupGlobalListeners() {
        // Modal open/close logic
        document.querySelectorAll('[data-modal-target]').forEach(trigger => {
            trigger.addEventListener('click', () => {
                const modal = document.getElementById(trigger.dataset.modalTarget);
                modal?.classList.remove('hidden');
            });
        });

        document.querySelectorAll('.modal-close-btn').forEach(button => {
            button.addEventListener('click', () => {
                button.closest('.fixed.inset-0').classList.add('hidden');
            });
        });
        
        // Share button clipboard functionality
        document.body.addEventListener('click', async (e) => {
            if (e.target.classList.contains('share-quiz-btn')) {
                const url = e.target.dataset.url;
                setButtonLoading(e.target, 'Copied!');
                try {
                    await navigator.clipboard.writeText(url);
                } catch (err) {
                    console.error('Failed to copy link:', err);
                    alert('Could not copy link.');
                } finally {
                    setTimeout(() => setButtonActive(e.target, 'Share'), 2000);
                }
            }
        });
    }

    // --- API & DATA FETCHING ---

    async function fetchNotes(isNewFilter = false) {
        if (isLoading || (!hasMorePages && !isNewFilter)) return;
        isLoading = true;
        const notesContainer = document.getElementById('notes-container');
        const loadingIndicator = document.getElementById('loading-indicator');

        if (isNewFilter) {
            currentPage = 1;
            hasMorePages = true;
            if(notesContainer) notesContainer.innerHTML = '';
        }
        loadingIndicator?.classList.remove('hidden');

        try {
            const contributorFilter = document.getElementById('contributor-filter').value;
            const response = await fetch(`/api/notes/${projectId}?page=${currentPage}&contributor_filter=${contributorFilter}`);
            if (!response.ok) throw new Error('Failed to fetch notes');
            const newNotes = await response.json();

            if (newNotes.length > 0) {
                newNotes.forEach(note => renderNote(note));
                currentPage++;
            } else {
                hasMorePages = false;
                if (currentPage === 1 && notesContainer?.innerHTML === '') {
                    notesContainer.innerHTML = `<p class="text-slate-500 text-center col-span-full py-8">No notes found for this filter.</p>`;
                }
            }
        } catch (error) {
            console.error('Failed to fetch notes:', error);
        } finally {
            isLoading = false;
            loadingIndicator?.classList.add('hidden');
        }
    }

    async function fetchAndRenderPreviewNotes() {
        const { searchQuery, selectedTags, currentPage, searchType } = previewState;
        const params = new URLSearchParams({ 
            page: currentPage, 
            q: searchQuery, 
            tags: selectedTags.join(',') 
        });

        if (isAtlas) {
            params.append('search_type', searchType);
        }
        
        const previewNotesContainer = document.getElementById('preview-notes-container');
        
        try {
            const response = await fetch(`/api/search-notes/${projectId}?${params}`);
            const data = await response.json();
            previewState.totalPages = data.total_pages;

            previewNotesContainer.innerHTML = '';
            if (data.notes.length === 0) {
                previewNotesContainer.innerHTML = '<p class="text-slate-500 p-4">No notes found.</p>';
            }
            data.notes.forEach(note => {
                noteSelectionCandidates.set(note._id, note);
                previewNotesContainer.appendChild(createPreviewNoteElement(note));
            });
            renderPagination();
            document.getElementById('preview-results-summary').textContent = `Showing page ${previewState.currentPage} of ${previewState.totalPages || 1}. (${data.total_notes} total)`;
        } catch (error) { console.error('Failed to search notes:', error); }
    }

    // --- FORM SUBMISSION HANDLERS ---

    async function handleNewProjectSubmit(e) {
        e.preventDefault();
        const name = e.target.querySelector('#project-name-input').value.trim();
        const project_goal = e.target.querySelector('#project-goal-input').value.trim();
        const project_type = e.target.querySelector('#project-type-select').value;
        if (!name || !project_goal) return;

        try {
            const response = await fetch('/api/projects', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, project_goal, project_type })
            });
            if (!response.ok) throw new Error('Project creation failed.');
            const data = await response.json();

            if (data.status === 'success') {
                window.location.href = `/project/${data.project._id}`;
            } else { alert(data.message); }
        } catch (error) { console.error('Error creating project:', error); }
    }

    async function handleNoteFormSubmit(e) {
        e.preventDefault();
        const contentEl = document.getElementById('note-content');
        const content = contentEl.value.trim();
        if (!content) return;
        
        const tags = document.getElementById('note-tags-input')?.value || '';
        try {
            const response = await fetch('/api/notes', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ content, project_id: projectId, tags }) 
            });
            if (!response.ok) throw new Error('Failed to add note');
            const result = await response.json();
            
            contentEl.value = '';
            document.getElementById('note-tags-input').value = '';
            document.getElementById('tag-suggestions-container').innerHTML = '';
            if (document.querySelector('#notes-container p')) {
                document.querySelector('#notes-container').innerHTML = '';
            }
            renderNote(result.note, true); // Prepend new note
        } catch (error) {
            console.error('Error submitting note:', error);
            alert('A network error occurred. Please try again.');
        }
    }
    
    async function handleTokenFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const labelInput = form.querySelector('#contributor-label-input');
        const promptInput = form.querySelector('#prompt-textarea');
        const resultDiv = document.getElementById('token-result');
        const submitBtn = form.querySelector('button[type="submit"]');

        const label = labelInput.value.trim();
        const prompt = promptInput.value.trim();

        if (!label || !prompt) {
            alert("Please provide both a contributor's name and a prompt.");
            return;
        }

        setButtonLoading(submitBtn, 'Generating...');
        resultDiv.innerHTML = '';

        try {
            const response = await fetch('/api/generate-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, prompt, project_id: projectId })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to generate link.');
            }

            if (data.status === 'success') {
                resultDiv.innerHTML = `
                    <p class="text-sm font-medium text-slate-700 mb-2">Share this unique link with ${data.label}:</p>
                    <div class="flex items-center space-x-2">
                        <input type="text" value="${data.invite_url}" readonly class="form-input flex-grow bg-slate-100">
                        <button type="button" class="btn btn-secondary flex-shrink-0 copy-btn">Copy</button>
                    </div>
                `;
                
                resultDiv.querySelector('.copy-btn').addEventListener('click', (copyEvent) => {
                    const urlToCopy = copyEvent.target.previousElementSibling.value;
                    navigator.clipboard.writeText(urlToCopy).then(() => {
                        setButtonLoading(copyEvent.target, 'Copied!');
                        setTimeout(() => setButtonActive(copyEvent.target, 'Copy'), 2000);
                    }).catch(err => console.error('Failed to copy text: ', err));
                });

                // Clear the form for the next entry
                labelInput.value = '';
                promptInput.value = '';
            } else {
                resultDiv.innerHTML = `<p class="text-red-600">${data.message}</p>`;
            }
        } catch (error) {
            console.error('Error generating token:', error);
            resultDiv.innerHTML = `<p class="text-red-600">An unexpected error occurred: ${error.message}</p>`;
        } finally {
            setButtonActive(submitBtn, 'Generate Invite Link');
        }
    }
    
    async function handleGenerateNotesSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const topicInput = form.querySelector('#note-topic-input');
        const submitBtn = form.querySelector('button[type="submit"]');
        const topic = topicInput.value.trim();

        if (!topic) {
            alert('Please enter a topic to generate notes for.');
            return;
        }

        setButtonLoading(submitBtn, 'Generating...');

        try {
            const response = await fetch('/api/generate-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_id: projectId, topic })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to generate notes.');
            }

            if (data.status === 'success' && data.notes.length > 0) {
                // Check if the "no notes" message is showing and remove it
                const notesContainer = document.getElementById('notes-container');
                const noNotesMessage = notesContainer.querySelector('p');
                if (noNotesMessage && notesContainer.children.length === 1) {
                    notesContainer.innerHTML = '';
                }
                
                // Render each new note by prepending it to the list
                data.notes.reverse().forEach(note => {
                    renderNote(note, true); // true for prepend
                });
                topicInput.value = ''; // Clear input on success
            } else {
                alert('The AI could not generate notes for this topic. Please try a different one.');
            }

        } catch (error) {
            console.error('Error generating notes:', error);
            alert(`An error occurred: ${error.message}`);
        } finally {
            setButtonActive(submitBtn, 'Generate Notes');
        }
    }

    // --- AI ACTION HANDLERS ---
    
    function handleConfirmAction() {
        if (selectedNotes.length === 0) {
            alert("Please select at least one note.");
            return;
        }
        if (activeAIAction === 'generate-quiz') {
            handleGenerateQuiz();
        } else if (activeAIAction === 'generate-story') {
            handleGenerateStory();
        }
    }

    async function handleGenerateQuiz() {
        const quizTitle = prompt("Enter a title for your new quiz:", "Practice Quiz");
        if (!quizTitle) return;

        setButtonLoading(document.getElementById('confirm-action-btn'), 'Generating...');
        
        try {
            const response = await fetch('/api/generate-quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notes: selectedNotes.map(n => ({_id: n._id, content: n.content})),
                    title: quizTitle,
                    num_questions: parseInt(quizGenerationOptions.num_questions, 10),
                    question_type: quizGenerationOptions.question_type,
                    difficulty: quizGenerationOptions.difficulty,
                    knowledge_source: quizGenerationOptions.knowledge_source
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate quiz.');
            }
            
            document.getElementById('note-selection-modal').classList.add('hidden');
            alert('Quiz generated successfully! The page will now reload to show it in the list.');
            window.location.reload();

        } catch (error) {
            console.error('Quiz Generation Error:', error);
            alert(`Error: ${error.message}`);
        } finally {
            setButtonActive(document.getElementById('confirm-action-btn'), 'Confirm Selection');
        }
    }

    async function handleGenerateStory() {
        const selectedTone = document.getElementById('story-tone-select').value;
        setButtonLoading(document.getElementById('confirm-action-btn'), 'Weaving...');

        try {
            const response = await fetch('/api/generate-story', {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    project_name: projectName, 
                    tone: selectedTone, 
                    notes: selectedNotes 
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'API Error');
            
            document.getElementById('note-selection-modal').classList.add('hidden');
            const storyModal = document.getElementById('story-modal');
            document.getElementById('story-modal-title').textContent = `Your Story: ${projectName}`;
            document.getElementById('story-modal-content').innerHTML = `<div class="prose max-w-none">${data.story.replace(/\n/g, '<br>')}</div>`;
            storyModal.classList.remove('hidden');

        } catch (error) {
            console.error('Error generating story:', error);
            alert(`Failed to generate story: ${error.message}`);
        } finally {
            setButtonActive(document.getElementById('confirm-action-btn'), 'Confirm Selection');
        }
    }

    // --- UI RENDERING & HELPERS ---
    
    function renderNote(note, prepend = false) {
        const notesContainer = document.getElementById('notes-container');
        if (!notesContainer) return;
        
        const noteCard = document.createElement('div');
        noteCard.className = 'note-card'; // Add animation classes if you have them
        const tagsHTML = note.tags?.length > 0 ? note.tags.map(t => `<span class="tag">${t}</span>`).join('') : '';
        let formattedContent = note.content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        noteCard.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="contributor-tag">${note.contributor_label}</span>
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

    function resetAndOpenNoteSelector(title) {
        selectedNotes = [];
        noteSelectionCandidates.clear();
        previewState = { searchQuery: '', selectedTags: [], currentPage: 1, totalPages: 1, searchType: 'vector' };
        
        const searchTypeContainer = document.getElementById('search-type-selector-container');
        if (isAtlas) {
            searchTypeContainer.classList.remove('hidden');
        } else {
            searchTypeContainer.classList.add('hidden');
        }

        document.getElementById('note-selection-title').textContent = title;
        updateSelectedNotesUI();
        document.getElementById('preview-search-input').value = '';
        document.getElementById('preview-search-type').value = 'vector'; // Reset to default
        fetchAndRenderTags();
        fetchAndRenderPreviewNotes();
        document.getElementById('note-selection-modal').classList.remove('hidden');
    }
    
    function createPreviewNoteElement(note) {
        const isSelected = selectedNotes.some(n => n._id === note._id);
        const element = document.createElement('div');
        element.className = 'p-3 border rounded-md bg-white flex items-start space-x-3 transition-colors hover:bg-slate-50';
        const contentPreview = note.content.substring(0, 150) + (note.content.length > 150 ? '...' : '');
        
        element.innerHTML = `
            <input type="checkbox" data-note-id="${note._id}" data-note-content="${encodeURIComponent(note.content)}" class="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" ${isSelected ? 'checked' : ''}>
            <div>
                <label class="block text-xs font-bold text-slate-500 cursor-pointer">${note.contributor_label}</label>
                <p class="text-sm text-slate-800 cursor-pointer">${contentPreview}</p>
            </div>`;
        return element;
    }
    
    function renderPagination() {
        const { currentPage, totalPages } = previewState;
        const container = document.getElementById('preview-pagination-container');
        container.innerHTML = `<button class="pagination-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
                               <span class="text-sm text-slate-600">Page ${currentPage} of ${totalPages || 1}</span>
                               <button class="pagination-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>`;
    }
    
    function updateSelectedNotesUI() {
        const countEl = document.getElementById('selected-notes-count');
        const containerEl = document.getElementById('selected-notes-container');
        if (!countEl || !containerEl) return;

        countEl.textContent = selectedNotes.length;
        document.getElementById('confirm-action-btn').disabled = selectedNotes.length === 0;

        containerEl.innerHTML = '';
        selectedNotes.forEach(note => {
            const noteDiv = document.createElement('div');
            noteDiv.className = 'p-2 border text-sm bg-white rounded shadow-sm';
            noteDiv.textContent = note.content.substring(0, 70) + (note.content.length > 70 ? '...' : '');
            containerEl.appendChild(noteDiv);
        });
    }

    function handleNoteCheckboxChange(e) {
        if (e.target.matches('input[type="checkbox"]')) {
            const noteId = e.target.dataset.noteId;
            const noteContent = decodeURIComponent(e.target.dataset.noteContent);
            
            if (e.target.checked) {
                if (!selectedNotes.some(n => n._id === noteId)) {
                    selectedNotes.push({ _id: noteId, content: noteContent });
                }
            } else {
                selectedNotes = selectedNotes.filter(n => n._id !== noteId);
            }
            updateSelectedNotesUI();
        }
    }
    
    async function populateContributors() {
        const filterEl = document.getElementById('contributor-filter');
        if (!filterEl) return;
        try {
            const response = await fetch(`/api/contributors/${projectId}`);
            const contributors = await response.json();
            filterEl.innerHTML = contributors.map(c => `<option value="${c}">${c}</option>`).join('');
        } catch (error) { console.error('Failed to populate contributors:', error); }
    }

    async function fetchAndRenderTags() {
        const container = document.getElementById('preview-tags-container');
        if (!container) return;
        try {
            const response = await fetch(`/api/get-tags/${projectId}`);
            const tags = await response.json();
            container.innerHTML = tags.map(tag => `<label class="flex items-center space-x-2 cursor-pointer p-1 rounded hover:bg-indigo-50"><input type="checkbox" class="tag-checkbox" value="${tag}"><span>${tag}</span></label>`).join('');
        } catch (error) { console.error('Failed to fetch tags:', error); }
    }
    
    async function handleSuggestTags() {
        const content = document.getElementById('note-content').value.trim();
        const btn = document.getElementById('suggest-tags-btn');
        const container = document.getElementById('tag-suggestions-container');
        if (!content) { alert('Please write a note first.'); return; }
        
        setButtonLoading(btn, '...');
        container.innerHTML = `<p class="text-slate-500 text-sm">AI is thinking...</p>`;
        
        try {
            const response = await fetch('/api/suggest-tags', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, project_id: projectId })
            });
            const data = await response.json();
            container.innerHTML = '';
            data.tags.forEach(tag => {
                const tagEl = document.createElement('button');
                tagEl.type = 'button';
                tagEl.className = 'tag-suggestion';
                tagEl.textContent = tag;
                tagEl.onclick = () => addTagToInput(tag);
                container.appendChild(tagEl);
            });
        } catch (error) {
            console.error("Failed to fetch tag suggestions:", error);
        } finally {
            setButtonActive(btn, 'Suggest');
        }
    }
    
    function addTagToInput(tagToAdd) {
        const tagsInput = document.getElementById('note-tags-input');
        const currentTags = new Set(tagsInput.value.split(',').map(t => t.trim()).filter(Boolean));
        currentTags.add(tagToAdd);
        tagsInput.value = Array.from(currentTags).join(', ');
    }

    function setButtonLoading(button, text = 'Loading...') {
        if(button) {
            button.disabled = true;
            button.textContent = text;
        }
    }

    function setButtonActive(button, text) {
        if(button) {
            button.disabled = false;
            button.textContent = text;
        }
    }

    // --- INITIALIZE THE APP ---
    initializePage();
});
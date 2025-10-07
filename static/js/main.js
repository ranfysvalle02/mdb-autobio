document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBAL STATE & CONSTANTS ---
    const jsData = document.getElementById('js-data');
    const projectId = jsData?.dataset.projectId;
    const projectName = jsData?.dataset.projectName;
    const inviteToken = jsData?.dataset.inviteToken;
    const activePrompt = jsData?.dataset.activePrompt;

    // Determine current page/view
    const isWorkspaceView = document.getElementById('new-project-form');
    const isProjectView = !isWorkspaceView && projectId && !inviteToken;
    const isInviteView = !isWorkspaceView && projectId && inviteToken;

    let currentPage = 1;
    let isLoading = false;
    let hasMorePages = true;
    let searchDebounceTimer;
    
    let storyCandidates = { notes: new Map(), selectedNotes: new Map() };
    let previewState = { searchQuery: '', selectedTags: [], currentPage: 1, totalPages: 1 };
    
    // --- ELEMENT SELECTORS ---
    // Universal: Intersection Observer for card animations
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    // Workspace View
    const newProjectForm = document.getElementById('new-project-form');
    const projectsContainer = document.getElementById('projects-container');
    const noProjectsMessage = document.getElementById('no-projects-message');
    
    // Project & Invite Views
    const noteForm = document.getElementById('note-form');
    
    // Project View
    const tokenForm = document.getElementById('token-form');
    const sharedTokenForm = document.getElementById('shared-token-form');
    const notesContainer = document.getElementById('notes-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const contributorFilter = document.getElementById('contributor-filter');
    const generateStoryBtn = document.getElementById('generate-story-btn');
    const suggestTagsBtn = document.getElementById('suggest-tags-btn');
    const tagSuggestionsContainer = document.getElementById('tag-suggestions-container');
    
    // Invite View
    const followUpContainer = document.getElementById('follow-up-container');
    const followUpList = document.getElementById('follow-up-list');
    
    // Modals (Project View)
    const storyModal = document.getElementById('story-modal');
    const storyModalTitle = document.getElementById('story-modal-title');
    const storyModalContent = document.getElementById('story-modal-content');
    const storyPreviewModal = document.getElementById('story-preview-modal');
    const confirmStoryGenerationBtn = document.getElementById('confirm-story-generation-btn');
    const previewSearchInput = document.getElementById('preview-search-input');
    const previewTagsContainer = document.getElementById('preview-tags-container');
    const selectedNotesContainer = document.getElementById('selected-notes-container');
    const selectedNotesCount = document.getElementById('selected-notes-count');
    const previewPaginationContainer = document.getElementById('preview-pagination-container');
    const previewResultsSummary = document.getElementById('preview-results-summary');
    const previewNotesContainer = document.getElementById('preview-notes-container');
    const storyPreviewTitle = document.getElementById('story-preview-title');

    // --- CORE FUNCTIONS ---
    
    const renderNote = (note, prepend = false) => {
        if (!notesContainer) return;
        const noteCard = document.createElement('div');
        noteCard.className = 'card-reveal note-card';
        const tagsHTML = note.tags?.length > 0 ? note.tags.map(t => `<span class="inline-block bg-sky-100 text-sky-800 text-xs font-semibold px-2.5 py-1 rounded-full">${t}</span>`).join('') : '';
        noteCard.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="inline-block bg-pink-100 text-pink-800 text-xs font-semibold px-2.5 py-1 rounded-full">${note.contributor_label}</span>
                ${tagsHTML}
            </div>
            <p class="text-xs text-slate-400 mb-3">${note.formatted_timestamp}</p>
            <p class="text-slate-700 whitespace-pre-wrap leading-relaxed">${note.content}</p>
        `;
        if (prepend) notesContainer.prepend(noteCard);
        else notesContainer.appendChild(noteCard);
        observer.observe(noteCard);
    };

    const fetchNotes = async (isNewFilter = false) => {
        if (isLoading || !hasMorePages) return;
        isLoading = true;
        if (isNewFilter) {
            currentPage = 1; hasMorePages = true;
            if (notesContainer) notesContainer.innerHTML = '';
        }
        if (loadingIndicator) loadingIndicator.classList.remove('hidden');
        const params = new URLSearchParams({ page: currentPage, contributor_filter: contributorFilter.value });
        try {
            const response = await fetch(`/api/notes/${projectId}?${params}`);
            if (!response.ok) throw new Error('Failed to fetch notes');
            const newNotes = await response.json();
            if (newNotes.length > 0) {
                newNotes.forEach(note => renderNote(note));
                currentPage++;
            } else {
                hasMorePages = false;
                if (currentPage === 1 && notesContainer && notesContainer.innerHTML === '') {
                    notesContainer.innerHTML = `<p class="text-slate-500 text-center col-span-full py-8">No notes found for this filter.</p>`;
                }
            }
        } catch (error) {
            console.error('Failed to fetch notes:', error);
            if (notesContainer && notesContainer.innerHTML === '') {
                 notesContainer.innerHTML = `<p class="text-red-500 text-center col-span-full py-8">Could not load notes. Please refresh the page.</p>`;
            }
        }
        finally { isLoading = false; if (loadingIndicator) loadingIndicator.classList.add('hidden'); }
    };

    // --- EVENT HANDLERS ---

    const handleNoteFormSubmit = async (e) => {
        e.preventDefault();
        const contentEl = document.getElementById('note-content');
        const content = contentEl.value.trim();
        if (!content) return;
        
        const tags = isProjectView ? document.getElementById('note-tags-input').value : '';
        const body = { content, project_id: projectId, tags, invite_token: inviteToken, active_prompt: activePrompt };
        
        try {
            const response = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error('Failed to add note');
            const result = await response.json();
            
            contentEl.value = '';
            if (isInviteView) {
                updateFollowUps(result.new_follow_ups);
                document.getElementById('note-form').parentElement.innerHTML = `<div class="text-center p-8"><h3 class="text-2xl font-bold text-emerald-600">Thank you!</h3><p class="text-slate-600 mt-2">Your contribution has been added.</p></div>`;
            } else {
                if (document.getElementById('note-tags-input')) document.getElementById('note-tags-input').value = '';
                if (tagSuggestionsContainer) tagSuggestionsContainer.innerHTML = '';
                if (notesContainer.querySelector('p')) notesContainer.innerHTML = '';
                renderNote(result.note, true);
                populateContributors();
            }
        } catch (error) {
            console.error('Error submitting note:', error);
            alert('A network error occurred. Please try again.');
        }
    };

    const handleNewProjectSubmit = async (e) => {
        e.preventDefault();
        const name = e.target.querySelector('#project-name-input').value.trim();
        const project_goal = e.target.querySelector('#project-goal-input').value.trim();
        if (!name || !project_goal) return;
        try {
            const response = await fetch('/api/projects', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, project_goal })
            });
            const data = await response.json();
            if (data.status === 'success') {
                const project = data.project;
                const projectLink = document.createElement('a');
                projectLink.href = `/project/${project._id}`;
                projectLink.className = 'card-reveal project-card';
                projectLink.innerHTML = `
                    <h4 class="text-xl font-bold text-slate-800 truncate mb-2">${project.name}</h4>
                    <p class="text-sm text-slate-600 italic border-l-2 border-pink-200 pl-3 mb-4">"${project.project_goal}"</p>
                    <p class="text-xs text-slate-500 mt-auto pt-2 border-t border-slate-200/80">Created: ${new Date(project.created_at).toLocaleDateString()}</p>
                `;
                projectsContainer.prepend(projectLink);
                observer.observe(projectLink);
                e.target.reset();
                if(noProjectsMessage) noProjectsMessage.remove();
            } else { alert(data.message); }
        } catch (error) { console.error('Error creating project:', error); }
    };
    
    const handleTokenFormSubmit = async (e) => {
        e.preventDefault();
        const label = e.target.querySelector('#contributor-label-input').value;
        const prompt = e.target.querySelector('#prompt-textarea').value;
        const resultDiv = document.getElementById('token-result');
        try {
            const response = await fetch('/api/generate-token', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, project_id: projectId, prompt })
            });
            const data = await response.json();
            if (data.status === 'success') {
                resultDiv.innerHTML = `<p class="text-sm text-slate-600 mb-2">Share this link with ${data.label}:</p><div class="flex space-x-2"><input type="text" readonly value="${data.invite_url}" class="form-input flex-grow p-2"><button type="button" class="btn btn-secondary copy-btn">Copy</button></div>`;
                resultDiv.querySelector('.copy-btn').addEventListener('click', (copyEvent) => {
                    navigator.clipboard.writeText(data.invite_url).then(() => {
                        copyEvent.target.textContent = 'Copied!';
                        setTimeout(() => { copyEvent.target.textContent = 'Copy'; }, 2000);
                    });
                });
            } else { resultDiv.textContent = data.message || 'An error occurred.'; }
        } catch (error) { console.error('Error generating token:', error); }
    };

    const handleSharedTokenFormSubmit = async (e) => {
        e.preventDefault();
        const prompt = e.target.querySelector('#shared-prompt-textarea').value.trim();
        const resultDiv = document.getElementById('shared-token-result');
        if (!prompt || !projectId) return;

        try {
            const response = await fetch('/api/generate-shared-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_id: projectId, prompt })
            });
            const data = await response.json();
            if (data.status === 'success') {
                resultDiv.innerHTML = `<p class="text-sm text-slate-600 mb-2">Share this single link with your entire group:</p><div class="flex space-x-2"><input type="text" readonly value="${data.shared_url}" class="form-input flex-grow p-2"><button type="button" class="btn btn-secondary copy-btn">Copy</button></div>`;
                resultDiv.querySelector('.copy-btn').addEventListener('click', (copyEvent) => {
                    navigator.clipboard.writeText(data.shared_url).then(() => {
                        copyEvent.target.textContent = 'Copied!';
                        setTimeout(() => { copyEvent.target.textContent = 'Copy'; }, 2000);
                    });
                });
            } else {
                resultDiv.textContent = data.message || 'An error occurred.';
            }
        } catch (error) {
            console.error('Error generating shared token:', error);
            resultDiv.textContent = 'A network error occurred.';
        }
    };

    const handleSuggestTags = async (e) => {
        const content = document.getElementById('note-content').value.trim();
        if (!content) { alert('Please write something first.'); return; }
        suggestTagsBtn.disabled = true; suggestTagsBtn.textContent = '...';
        tagSuggestionsContainer.innerHTML = `<p class="text-slate-500 text-sm">AI is thinking...</p>`;
        try {
            const response = await fetch('/api/suggest-tags', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, project_id: projectId })
            });
            const data = await response.json();
            renderTagSuggestions(data.tags);
        } catch (error) {
            console.error("Failed to fetch tag suggestions:", error);
            tagSuggestionsContainer.innerHTML = `<p class="text-red-500 text-sm">Could not get suggestions.</p>`;
        } finally { suggestTagsBtn.disabled = false; suggestTagsBtn.textContent = 'Suggest'; }
    };
    
    // --- UI & HELPER FUNCTIONS ---

    const populateContributors = async () => {
        if (!contributorFilter) return;
        try {
            const currentFilter = contributorFilter.value;
            const response = await fetch(`/api/contributors/${projectId}`);
            const contributors = await response.json();
            contributorFilter.innerHTML = '';
            contributors.forEach(label => {
                const option = document.createElement('option');
                option.value = label; option.textContent = label;
                contributorFilter.appendChild(option);
            });
            contributorFilter.value = currentFilter || 'All Contributors';
        } catch (error) { console.error('Failed to populate contributors:', error); }
    };
    
    const renderTagSuggestions = (tags) => {
        if (!tagSuggestionsContainer) return;
        tagSuggestionsContainer.innerHTML = '';
        if (!tags || tags.length === 0) {
            tagSuggestionsContainer.innerHTML = `<p class="text-slate-500 text-sm">No suggestions found.</p>`; return;
        }
        tags.forEach(tag => {
            const tagEl = document.createElement('button');
            tagEl.type = 'button';
            tagEl.className = 'tag-suggestion bg-teal-100 text-teal-800 text-sm font-semibold px-3 py-1 rounded-full hover:bg-teal-200';
            tagEl.textContent = tag;
            tagEl.addEventListener('click', () => addTagToInput(tag));
            tagSuggestionsContainer.appendChild(tagEl);
        });
    };
    
    const addTagToInput = (tagToAdd) => {
        const tagsInput = document.getElementById('note-tags-input');
        const currentTags = tagsInput.value.trim() ? tagsInput.value.split(',').map(t => t.trim().toLowerCase()) : [];
        const tagSet = new Set(currentTags);
        if (!tagSet.has(tagToAdd.toLowerCase())) tagSet.add(tagToAdd.toLowerCase());
        tagsInput.value = Array.from(tagSet).join(', ');
    };
    
    const updateFollowUps = (questions) => {
        if (!followUpList || !followUpContainer) return;
        followUpList.innerHTML = '';
        if (questions && questions.length > 0) {
            questions.forEach(q => {
                const li = document.createElement('li');
                li.className = 'p-4 bg-indigo-50/80 text-indigo-800 rounded-lg cursor-pointer hover:bg-indigo-100 transition-all duration-300 transform hover:scale-105';
                li.textContent = q;
                followUpList.appendChild(li);
            });
            followUpContainer.classList.remove('hidden');
        } else {
            followUpContainer.classList.add('hidden');
        }
    };
    
    // --- MODAL & STORY GENERATION FUNCTIONS ---

    const fetchAndRenderPreviewNotes = async () => {
        const { searchQuery, selectedTags, currentPage } = previewState;
        const params = new URLSearchParams({ page: currentPage, q: searchQuery, tags: selectedTags.join(',') });
        try {
            const response = await fetch(`/api/search-notes/${projectId}?${params}`);
            const data = await response.json();
            previewState.totalPages = data.total_pages;
            previewNotesContainer.innerHTML = '';
            if (data.notes.length === 0) previewNotesContainer.innerHTML = '<p class="text-slate-500 p-4">No notes found.</p>';
            data.notes.forEach(note => {
                storyCandidates.notes.set(note._id, note);
                const noteEl = createPreviewNoteElement(note);
                previewNotesContainer.appendChild(noteEl);
            });
            renderPagination();
            previewResultsSummary.textContent = `Showing page ${previewState.currentPage} of ${previewState.totalPages || 1}. (${data.total_notes} total)`;
        } catch (error) { console.error('Failed to search notes:', error); }
    };
    
    const createPreviewNoteElement = (note) => {
        const isSelected = storyCandidates.selectedNotes.has(note._id);
        const element = document.createElement('div');
        element.className = 'p-3 border rounded-md bg-white flex items-start space-x-3 transition-colors hover:bg-slate-50';
        const tagsHTML = note.tags?.length > 0 ? `<div class="mt-2 flex flex-wrap gap-1">${note.tags.map(t => `<span class="bg-sky-100 text-sky-800 text-xs px-2 py-0.5 rounded-full">${t}</span>`).join('')}</div>` : '';
        element.innerHTML = `<input type="checkbox" data-id="${note._id}" class="note-checkbox mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" ${isSelected ? 'checked' : ''}><div><label class="block text-xs font-bold text-slate-500 cursor-pointer">${note.contributor_label}</label><p class="text-sm text-slate-800 cursor-pointer">${note.content}</p>${tagsHTML}</div>`;
        return element;
    };
    
    const renderPagination = () => {
        const { currentPage, totalPages } = previewState;
        previewPaginationContainer.innerHTML = `<button class="pagination-btn bg-slate-200 px-3 py-1 rounded-md text-sm hover:bg-slate-300" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button><span class="text-sm text-slate-600">Page ${currentPage} of ${totalPages || 1}</span><button class="pagination-btn bg-slate-200 px-3 py-1 rounded-md text-sm hover:bg-slate-300" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>`;
    };
    
    const renderSelectedNotes = () => {
        selectedNotesContainer.innerHTML = '';
        storyCandidates.selectedNotes.forEach(note => {
            const el = document.createElement('div');
            el.className = 'p-2 border text-sm bg-white rounded shadow-sm';
            el.textContent = note.content.substring(0, 80) + (note.content.length > 80 ? '...' : '');
            selectedNotesContainer.appendChild(el);
        });
        const count = storyCandidates.selectedNotes.size;
        selectedNotesCount.textContent = count;
        confirmStoryGenerationBtn.disabled = count === 0;
    };
    
    const fetchAndRenderTags = async () => {
        try {
            const response = await fetch(`/api/get-tags/${projectId}`);
            const tags = await response.json();
            previewTagsContainer.innerHTML = tags.map(tag => `<label class="flex items-center space-x-2 cursor-pointer p-1 rounded hover:bg-indigo-50"><input type="checkbox" class="tag-checkbox rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" value="${tag}"><span>${tag}</span></label>`).join('');
        } catch (error) { console.error('Failed to fetch tags:', error); }
    };
    
    // --- INITIALIZATION & EVENT LISTENERS ---

    if (isWorkspaceView) {
        newProjectForm.addEventListener('submit', handleNewProjectSubmit);
        document.querySelectorAll('.card-reveal').forEach(card => observer.observe(card));
    }
    
    if (isProjectView) {
        tokenForm.addEventListener('submit', handleTokenFormSubmit);
        if (sharedTokenForm) sharedTokenForm.addEventListener('submit', handleSharedTokenFormSubmit);
        contributorFilter.addEventListener('change', () => fetchNotes(true));
        
        generateStoryBtn.addEventListener('click', async () => {
            storyCandidates.notes.clear(); storyCandidates.selectedNotes.clear();
            previewState = { searchQuery: '', selectedTags: [], currentPage: 1, totalPages: 1 };
            if (previewSearchInput) previewSearchInput.value = '';
            renderSelectedNotes();
            storyPreviewTitle.textContent = `Build Story for: ${projectName}`;
            await fetchAndRenderTags(); 
            await fetchAndRenderPreviewNotes();
        });

        suggestTagsBtn.addEventListener('click', handleSuggestTags);
        
        confirmStoryGenerationBtn.addEventListener('click', async () => {
            const notesToInclude = Array.from(storyCandidates.selectedNotes.values());
            if (notesToInclude.length === 0) return;
            const selectedTone = document.getElementById('story-tone-select').value;
            confirmStoryGenerationBtn.textContent = "Weaving..."; confirmStoryGenerationBtn.disabled = true;
            try {
                const response = await fetch('/api/generate-story', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ project_name: projectName, tone: selectedTone, notes: notesToInclude })
                });
                const data = await response.json();
                storyPreviewModal.classList.add('hidden');
                storyModalTitle.textContent = `Your Story: ${projectName}`;
                storyModalContent.innerHTML = `<div class="prose lg:prose-xl max-w-none">${data.story.replace(/\n/g, '<br>')}</div>`;
                storyModal.classList.remove('hidden');
            } catch (error) { console.error('Error in final story generation:', error); }
            finally { confirmStoryGenerationBtn.textContent = "Weave Story"; }
        });

        previewSearchInput.addEventListener('keyup', (e) => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(() => { previewState.searchQuery = e.target.value; previewState.currentPage = 1; fetchAndRenderPreviewNotes(); }, 500); });
        previewTagsContainer.addEventListener('change', () => { previewState.selectedTags = Array.from(previewTagsContainer.querySelectorAll('.tag-checkbox:checked')).map(cb => cb.value); previewState.currentPage = 1; fetchAndRenderPreviewNotes(); });
        previewPaginationContainer.addEventListener('click', (e) => { if (e.target.matches('.pagination-btn') && !e.target.disabled) { previewState.currentPage = parseInt(e.target.dataset.page); fetchAndRenderPreviewNotes(); } });
        previewNotesContainer.addEventListener('change', (e) => {
            if (e.target.matches('.note-checkbox')) {
                const noteId = e.target.dataset.id;
                const note = storyCandidates.notes.get(noteId);
                if (e.target.checked) storyCandidates.selectedNotes.set(noteId, note);
                else storyCandidates.selectedNotes.delete(noteId);
                renderSelectedNotes();
            }
        });
        
        populateContributors();
        fetchNotes();
        window.addEventListener('scroll', () => { if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) fetchNotes(); });
    }
    
    if (isInviteView) {
        followUpList.addEventListener('click', (e) => {
            if (e.target.tagName === 'LI') {
                const questionText = e.target.textContent;
                const noteTextarea = document.getElementById('note-content');
                noteTextarea.value = questionText + '\n\n';
                noteTextarea.focus();
                if (jsData) jsData.dataset.activePrompt = questionText;
            }
        });
    }

    if(noteForm) noteForm.addEventListener('submit', handleNoteFormSubmit);
});
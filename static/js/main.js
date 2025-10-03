document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBAL STATE & CONSTANTS ---
    const jsData = document.getElementById('js-data');
    const isInvited = jsData.dataset.isInvited === 'true';
    const inviteToken = jsData.dataset.inviteToken;
    
    let currentPage = 1;
    let isLoading = false;
    let hasMorePages = true;
    
    let storyCandidates = {
        notes: new Map(),
        selectedNotes: new Map()
    };
    let previewState = {
        timeFrame: '',
        searchQuery: '',
        selectedTags: [],
        currentPage: 1,
        totalPages: 1,
    };
    let searchDebounceTimer;

    // --- ELEMENT SELECTORS ---
    const textForm = document.getElementById('text-form');
    const tokenForm = document.getElementById('token-form');
    const entriesContainer = document.getElementById('entries-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const contributorFilter = document.getElementById('contributor-filter');
    const timeFrameFilter = document.getElementById('time-frame-filter');
    const labelFilter = document.getElementById('label-filter');
    const generateStoryBtn = document.getElementById('generate-story-btn');
    const followUpContainer = document.getElementById('follow-up-container');
    const followUpList = document.getElementById('follow-up-list');
    const storyModal = document.getElementById('story-modal');
    const storyModalCloseBtn = document.getElementById('story-modal-close-btn');
    const storyModalTitle = document.getElementById('story-modal-title');
    const storyModalContent = document.getElementById('story-modal-content');
    const storyPreviewModal = document.getElementById('story-preview-modal');
    const storyPreviewCloseBtn = document.getElementById('story-preview-close-btn');
    const confirmStoryGenerationBtn = document.getElementById('confirm-story-generation-btn');
    const previewSearchInput = document.getElementById('preview-search-input');
    const previewTagsContainer = document.getElementById('preview-tags-container');
    const selectedNotesContainer = document.getElementById('selected-notes-container');
    const selectedNotesCount = document.getElementById('selected-notes-count');
    const previewPaginationContainer = document.getElementById('preview-pagination-container');
    const previewResultsSummary = document.getElementById('preview-results-summary');
    const previewNotesContainer = document.getElementById('preview-notes-container');
    const storyPreviewTitle = document.getElementById('story-preview-title');
    // ✨ NEW: Element selectors for tag suggestion
    const suggestTagsBtn = document.getElementById('suggest-tags-btn');
    const tagSuggestionsContainer = document.getElementById('tag-suggestions-container');

    // --- INTERSECTION OBSERVER FOR SCROLL ANIMATIONS ---
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    // --- CORE FUNCTIONS ---

    const renderEntry = (entry, prepend = false) => {
        if (!entriesContainer) return;
        const entryCard = document.createElement('div');
        entryCard.className = 'entry-card bg-white/60 backdrop-blur-lg border border-white/20 p-6 rounded-xl shadow-lg transition-all duration-700 ease-out opacity-0 transform translate-y-5';
        
        const labelsHTML = entry.labels && entry.labels.length > 0 ? entry.labels.map(l => `<span class="inline-block bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-1 rounded-full">${l}</span>`).join('') : '';
        const tagsHTML = entry.tags && entry.tags.length > 0 ? entry.tags.map(t => `<span class="inline-block bg-sky-100 text-sky-800 text-xs font-semibold px-2.5 py-1 rounded-full">${t}</span>`).join('') : '';

        entryCard.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="inline-block bg-pink-100 text-pink-800 text-xs font-semibold px-2.5 py-1 rounded-full">${entry.contributor_label}</span>
                <span class="inline-block bg-indigo-100 text-indigo-800 text-xs font-semibold px-2.5 py-1 rounded-full">${entry.time_frame}</span>
                ${labelsHTML}
                ${tagsHTML}
            </div>
            <p class="text-xs text-slate-400 mb-3">${entry.formatted_timestamp}</p>
            <p class="text-slate-700 whitespace-pre-wrap leading-relaxed">${entry.content}</p>
        `;

        if (prepend) entriesContainer.prepend(entryCard);
        else entriesContainer.appendChild(entryCard);
        
        observer.observe(entryCard);
    };

    const fetchEntries = async (isNewFilter = false) => {
        if (isLoading || !hasMorePages) return;
        isLoading = true;
        
        if (isNewFilter) {
            currentPage = 1;
            hasMorePages = true;
            if (entriesContainer) entriesContainer.innerHTML = '';
        }
        
        if (loadingIndicator) loadingIndicator.classList.remove('hidden');

        const params = new URLSearchParams({
            page: currentPage,
            contributor_filter: contributorFilter.value,
            time_frame_filter: timeFrameFilter.value,
            label_filter: labelFilter.value
        });
        
        try {
            const response = await fetch(`/entries?${params}`);
            const newEntries = await response.json();

            if (newEntries.length > 0) {
                newEntries.forEach(entry => renderEntry(entry));
                currentPage++;
            } else {
                hasMorePages = false;
                if (currentPage === 1 && entriesContainer) entriesContainer.innerHTML = `<p class="text-slate-500 text-center col-span-full">No entries found for these filters.</p>`;
            }
        } catch (error)
        {
            console.error('Failed to fetch entries:', error);
        } finally {
            isLoading = false;
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
        }
    };

    const populateContributors = async () => {
        if (!contributorFilter) return;
        try {
            const response = await fetch('/contributors');
            const contributors = await response.json();
            contributorFilter.innerHTML = '';
            contributors.forEach(label => {
                const option = document.createElement('option');
                option.value = label;
                option.textContent = label;
                contributorFilter.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to populate contributors:', error);
        }
    };

    const populateLabelsFilter = async () => {
        if (!labelFilter) return;
        try {
            const response = await fetch('/get-labels');
            const labels = await response.json();
            labelFilter.innerHTML = '';
            labels.forEach(label => {
                const option = document.createElement('option');
                option.value = label;
                option.textContent = label;
                labelFilter.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to populate labels:', error);
        }
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

    // --- NOTE SELECTOR MODAL FUNCTIONS ---

    const fetchAndRenderPreviewNotes = async () => {
        const { timeFrame, searchQuery, selectedTags, currentPage } = previewState;
        const params = new URLSearchParams({
            time_frame: timeFrame,
            page: currentPage,
            q: searchQuery,
            tags: selectedTags.join(',')
        });

        try {
            const response = await fetch(`/search-notes?${params}`);
            const data = await response.json();
            previewState.totalPages = data.total_pages;

            previewNotesContainer.innerHTML = '';
            if (data.notes.length === 0) {
                previewNotesContainer.innerHTML = '<p class="text-slate-500 p-4">No entries found for these filters.</p>';
            }

            data.notes.forEach(note => {
                storyCandidates.notes.set(note._id, note);
                const noteEl = createPreviewNoteElement(note);
                previewNotesContainer.appendChild(noteEl);
            });

            renderPagination();
            previewResultsSummary.textContent = `Showing page ${previewState.currentPage} of ${previewState.totalPages || 1}. (${data.total_notes} total entries found)`;
        } catch (error) {
            console.error('Failed to search notes:', error);
            previewNotesContainer.innerHTML = '<p class="text-red-500 p-4">Error loading entries.</p>';
        }
    };

    const createPreviewNoteElement = (note) => {
        const isSelected = storyCandidates.selectedNotes.has(note._id);
        const element = document.createElement('div');
        element.className = 'p-3 border rounded-md bg-white flex items-start space-x-3 transition-colors hover:bg-slate-50';
        const tagsHTML = note.tags && note.tags.length > 0 ? `<div class="mt-2 flex flex-wrap gap-1">${note.tags.map(t => `<span class="bg-sky-100 text-sky-800 text-xs px-2 py-0.5 rounded-full">${t}</span>`).join('')}</div>` : '';
        
        element.innerHTML = `
            <input type="checkbox" data-id="${note._id}" class="note-checkbox mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" ${isSelected ? 'checked' : ''}>
            <div class="flex-1">
                <label class="block text-xs font-bold text-slate-500 cursor-pointer">${note.contributor_label}</label>
                <p class="text-sm text-slate-800 cursor-pointer">${note.content}</p>
                ${tagsHTML}
            </div>
        `;
        return element;
    };
    
    const renderPagination = () => {
        const { currentPage, totalPages } = previewState;
        previewPaginationContainer.innerHTML = `
            <button class="pagination-btn bg-slate-200 px-3 py-1 rounded-md text-sm hover:bg-slate-300 transition-colors" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
            <span class="text-sm text-slate-600">Page ${currentPage} of ${totalPages || 1}</span>
            <button class="pagination-btn bg-slate-200 px-3 py-1 rounded-md text-sm hover:bg-slate-300 transition-colors" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
        `;
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

    const fetchAndRenderTags = async (timeFrame) => {
        try {
            const response = await fetch(`/get-tags?time_frame=${timeFrame}`);
            const tags = await response.json();
            previewTagsContainer.innerHTML = '';
            tags.forEach(tag => {
                previewTagsContainer.innerHTML += `
                    <label class="flex items-center space-x-2 cursor-pointer p-1 rounded hover:bg-indigo-50">
                        <input type="checkbox" class="tag-checkbox rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" value="${tag}">
                        <span>${tag}</span>
                    </label>
                `;
            });
        } catch (error) {
            console.error('Failed to fetch tags:', error);
        }
    };

    const resetPreviewState = () => {
        storyCandidates.notes.clear();
        storyCandidates.selectedNotes.clear();
        previewState = { timeFrame: '', searchQuery: '', selectedTags: [], currentPage: 1, totalPages: 1 };
        if (previewSearchInput) previewSearchInput.value = '';
        renderSelectedNotes();
    };


    // --- EVENT HANDLERS ---

    const handleTextFormSubmit = async (e) => {
        e.preventDefault();
        const contentEl = document.getElementById('entry-content');
        const content = contentEl.value.trim();
        if (!content) return;
        
        let timeFrame, tags = '';
        if (isInvited) {
            timeFrame = jsData.dataset.timeFrame;
        } else {
            timeFrame = document.getElementById('entry-time-frame-select').value;
            tags = document.getElementById('entry-tags-input').value;
        }
        
        const body = { content, time_frame: timeFrame, tags, invite_token: inviteToken, active_prompt: jsData.dataset.invitePrompt };

        try {
            const response = await fetch('/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error('Failed to add entry');
            const result = await response.json();
            contentEl.value = '';
            
            if (isInvited) {
                updateFollowUps(result.new_follow_ups);
            } else {
                if (document.getElementById('entry-tags-input')) {
                    document.getElementById('entry-tags-input').value = '';
                }
                // ✨ NEW: Clear tag suggestions after successful submission
                if (tagSuggestionsContainer) tagSuggestionsContainer.innerHTML = '';
                renderEntry(result.entry, true);
                populateContributors();
                populateLabelsFilter();
            }
        } catch (error) {
            console.error('Error submitting entry:', error);
            alert('A network error occurred. Please try again.');
        }
    };

    const handleTokenFormSubmit = async (e) => {
        e.preventDefault();
        const label = e.target.querySelector('#contributor-label-input').value;
        const timeFrame = e.target.querySelector('#time-frame-select').value;
        const prompt = e.target.querySelector('#prompt-textarea').value;
        const labels = e.target.querySelector('#labels-input').value;
        const resultDiv = document.getElementById('token-result');

        try {
            const response = await fetch('/generate-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, time_frame: timeFrame, prompt, labels })
            });
            const data = await response.json();
            if (data.status === 'success') {
                resultDiv.innerHTML = `
                    <p class="text-sm text-slate-600 mb-2">Share this link with ${data.label}:</p>
                    <div class="flex space-x-2">
                        <input type="text" readonly id="invite-link-input" value="${data.invite_url}" class="flex-grow p-2 border border-slate-300 rounded-md bg-slate-50">
                        <button type="button" id="copy-link-btn" class="bg-slate-200 text-slate-700 font-semibold px-4 rounded-md hover:bg-slate-300 transition">Copy</button>
                    </div>
                `;
                
                document.getElementById('copy-link-btn').addEventListener('click', (copyEvent) => {
                    const linkInput = document.getElementById('invite-link-input');
                    const copyButton = copyEvent.target;
                    
                    navigator.clipboard.writeText(linkInput.value).then(() => {
                        copyButton.textContent = 'Copied!';
                        copyButton.classList.add('bg-green-200', 'text-green-800');
                        setTimeout(() => {
                            copyButton.textContent = 'Copy';
                            copyButton.classList.remove('bg-green-200', 'text-green-800');
                        }, 2000);
                    });
                });

            } else {
                resultDiv.textContent = data.message || 'An error occurred.';
            }
        } catch (error) {
             console.error('Error generating token:', error);
             resultDiv.textContent = 'A network error occurred.';
        }
    };
    
    const handleGenerateStory = async () => {
        const selectedTimeFrame = document.getElementById('story-time-frame-select').value;
        if (!selectedTimeFrame) {
            alert("Please select a time frame to begin building your story.");
            return;
        }

        resetPreviewState();
        previewState.timeFrame = selectedTimeFrame;
        
        storyPreviewTitle.textContent = `Build Story for: ${selectedTimeFrame}`;
        storyPreviewModal.classList.remove('hidden');

        await fetchAndRenderTags(selectedTimeFrame);
        await fetchAndRenderPreviewNotes();
    };

    const handleConfirmStoryGeneration = async () => {
        const notesToInclude = Array.from(storyCandidates.selectedNotes.values());
        if (notesToInclude.length === 0) return;
        
        const selectedTone = document.getElementById('story-tone-select').value;
        confirmStoryGenerationBtn.textContent = "Weaving...";
        confirmStoryGenerationBtn.disabled = true;

        try {
            const response = await fetch('/generate-story', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    time_frame: previewState.timeFrame, 
                    tone: selectedTone,
                    notes: notesToInclude 
                })
            });
            const data = await response.json();
            
            storyPreviewModal.classList.add('hidden');
            storyModalTitle.textContent = `Your Story: ${previewState.timeFrame}`;
            storyModalContent.innerHTML = `<div class="prose lg:prose-xl max-w-none">${data.story.replace(/\n/g, '<br>')}</div>`;
            storyModal.classList.remove('hidden');
        } catch (error) {
            console.error('Error in final story generation:', error);
        } finally {
            confirmStoryGenerationBtn.textContent = "Weave Story";
        }
    };
    
    const handleFollowUpClick = (e) => {
        if (e.target && e.target.tagName === 'LI') {
            const questionText = e.target.textContent;
            const entryTextarea = document.getElementById('entry-content');
            entryTextarea.value = questionText + '\n\n';
            entryTextarea.focus();
            jsData.dataset.invitePrompt = questionText;
        }
    };

    // --- ✨ NEW TAG SUGGESTION FUNCTIONS ---

    const handleSuggestTags = async (e) => {
        e.preventDefault();
        const content = document.getElementById('entry-content').value.trim();
        const timeFrame = document.getElementById('entry-time-frame-select').value;

        if (!content) {
            alert('Please write something in the entry box first to get suggestions.');
            return;
        }
        
        suggestTagsBtn.disabled = true;
        suggestTagsBtn.textContent = '...';
        tagSuggestionsContainer.innerHTML = `<p class="text-slate-500 text-sm">AI is thinking...</p>`;

        try {
            const response = await fetch('/suggest-tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, time_frame: timeFrame })
            });

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const data = await response.json();
            renderTagSuggestions(data.tags);

        } catch (error) {
            console.error("Failed to fetch tag suggestions:", error);
            tagSuggestionsContainer.innerHTML = `<p class="text-red-500 text-sm">Could not get suggestions.</p>`;
        } finally {
            suggestTagsBtn.disabled = false;
            suggestTagsBtn.textContent = 'Suggest';
        }
    };

    const renderTagSuggestions = (tags) => {
        if (!tagSuggestionsContainer) return;
        tagSuggestionsContainer.innerHTML = ''; // Clear previous suggestions or loading text

        if (!tags || tags.length === 0) {
            tagSuggestionsContainer.innerHTML = `<p class="text-slate-500 text-sm">No suggestions found.</p>`;
            return;
        }
        
        tags.forEach(tag => {
            const tagEl = document.createElement('button');
            tagEl.type = 'button'; // Prevent form submission
            tagEl.className = 'tag-suggestion bg-teal-100 text-teal-800 text-sm font-semibold px-3 py-1 rounded-full hover:bg-teal-200';
            tagEl.textContent = tag;
            tagEl.addEventListener('click', () => addTagToInput(tag));
            tagSuggestionsContainer.appendChild(tagEl);
        });
    };

    const addTagToInput = (tagToAdd) => {
        const tagsInput = document.getElementById('entry-tags-input');
        const currentTags = tagsInput.value.trim() 
            ? tagsInput.value.split(',').map(t => t.trim().toLowerCase()) 
            : [];
        
        const tagSet = new Set(currentTags);
        if (!tagSet.has(tagToAdd.toLowerCase())) {
            tagSet.add(tagToAdd.toLowerCase());
        }

        tagsInput.value = Array.from(tagSet).join(', ');
    };
    
    // --- INITIALIZATION & EVENT LISTENERS ---
    
    if (!isInvited) {
        // Main User View
        if (tokenForm) tokenForm.addEventListener('submit', handleTokenFormSubmit);
        if (contributorFilter) contributorFilter.addEventListener('change', () => fetchEntries(true));
        if (timeFrameFilter) timeFrameFilter.addEventListener('change', () => fetchEntries(true));
        if (labelFilter) labelFilter.addEventListener('change', () => fetchEntries(true));
        if (generateStoryBtn) generateStoryBtn.addEventListener('click', handleGenerateStory);
        // ✨ NEW: Event listener for the suggest tags button
        if (suggestTagsBtn) suggestTagsBtn.addEventListener('click', handleSuggestTags);
        
        if (storyModalCloseBtn) storyModalCloseBtn.addEventListener('click', () => storyModal.classList.add('hidden'));
        if (storyPreviewCloseBtn) storyPreviewCloseBtn.addEventListener('click', () => storyPreviewModal.classList.add('hidden'));
        if (confirmStoryGenerationBtn) confirmStoryGenerationBtn.addEventListener('click', handleConfirmStoryGeneration);

        if (previewSearchInput) {
            previewSearchInput.addEventListener('keyup', (e) => {
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    previewState.searchQuery = e.target.value;
                    previewState.currentPage = 1;
                    fetchAndRenderPreviewNotes();
                }, 500);
            });
        }

        if (previewTagsContainer) {
            previewTagsContainer.addEventListener('change', () => {
                previewState.selectedTags = Array.from(previewTagsContainer.querySelectorAll('.tag-checkbox:checked')).map(cb => cb.value);
                previewState.currentPage = 1;
                fetchAndRenderPreviewNotes();
            });
        }

        if (previewPaginationContainer) {
            previewPaginationContainer.addEventListener('click', (e) => {
                if (e.target.matches('.pagination-btn') && !e.target.disabled) {
                    previewState.currentPage = parseInt(e.target.dataset.page);
                    fetchAndRenderPreviewNotes();
                }
            });
        }

        if (previewNotesContainer) {
            previewNotesContainer.addEventListener('change', (e) => {
                if (e.target.matches('.note-checkbox')) {
                    const noteId = e.target.dataset.id;
                    const note = storyCandidates.notes.get(noteId);
                    if (e.target.checked) storyCandidates.selectedNotes.set(noteId, note);
                    else storyCandidates.selectedNotes.delete(noteId);
                    renderSelectedNotes();
                }
            });
        }

        populateContributors();
        populateLabelsFilter();
        fetchEntries();
        window.addEventListener('scroll', () => {
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
                fetchEntries();
            }
        });

    } else {
        // Invited Contributor View
        if (followUpList) followUpList.addEventListener('click', handleFollowUpClick);
    }
    
    if (textForm) textForm.addEventListener('submit', handleTextFormSubmit);
});
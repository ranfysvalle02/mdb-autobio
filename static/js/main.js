// static/js/main.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selectors ---
    const textForm = document.getElementById('text-form');
    const textInput = document.getElementById('text-input');
    const timeFrameSelect = document.getElementById('time-frame-select'); // NEW
    const timeFrameFilter = document.getElementById('time-frame-filter'); // NEW
    const recordBtn = document.getElementById('record-btn');
    const recordBtnText = document.getElementById('record-btn-text');
    const recordingStatus = document.getElementById('recording-status');
    const entriesContainer = document.getElementById('entries-container');
    const speechSupportNotice = document.getElementById('speech-support-notice');
    const loadingIndicator = document.getElementById('loading-indicator');

    // --- State for Pagination & Filtering ---
    let currentPage = 2; // Start with 2 because page 1 is already loaded
    let currentFilter = timeFrameFilter.value; // Store the current filter value
    let isLoading = false;
    let noMoreEntries = false;

    // --- Speech Recognition Setup (unchanged) ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;
    let isRecording = false;

    if (SpeechRecognition) {
        // ... (Speech Recognition setup code remains the same) ...
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecording = true;
            recordBtnText.textContent = 'Stop Listening';
            recordBtn.classList.add('bg-red-500', 'hover:bg-red-600');
            recordBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            recordingStatus.textContent = 'Listening...';
            recordingStatus.classList.add('recording-indicator');
        };

        recognition.onend = () => {
            isRecording = false;
            recordBtnText.textContent = 'Use Voice';
            recordBtn.classList.remove('bg-red-500', 'hover:bg-red-600');
            recordBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
            recordingStatus.textContent = '';
            recordingStatus.classList.remove('recording-indicator');
        };
        
        recognition.onresult = (event) => {
            let final_transcript = '';
            let interim_transcript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                event.results[i].isFinal ? final_transcript += event.results[i][0].transcript : interim_transcript += event.results[i][0].transcript;
            }
            // Use the correct method to update the input based on cursor position
            const start = textInput.selectionStart;
            const end = textInput.selectionEnd;
            const value = textInput.value;
            textInput.value = value.substring(0, start) + final_transcript + interim_transcript + value.substring(end);
            textInput.selectionEnd = start + final_transcript.length + interim_transcript.length; // Move cursor
        };

        recognition.onerror = (event) => console.error('Speech recognition error:', event.error);
    } else {
        recordBtn.disabled = true;
        speechSupportNotice.classList.remove('hidden');
    }
    
    // --- DOM Manipulation Functions ---

    // Creates a new entry card and adds it to the page (MODIFIED)
    const addEntryToDOM = (entry, prepend = false) => {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'bg-white p-4 rounded-lg shadow-sm entry-card';
        
        const timeFrameBadge = `<span class="inline-block bg-indigo-100 text-indigo-800 text-xs font-medium px-2.5 py-0.5 rounded-full mb-2">${entry.time_frame}</span>`;

        const contentP = document.createElement('p');
        contentP.className = 'text-gray-700 whitespace-pre-wrap';
        contentP.textContent = entry.content;

        entryDiv.innerHTML = `${timeFrameBadge} <p class="text-sm text-gray-500 mb-2">${entry.formatted_timestamp}</p>`;
        entryDiv.appendChild(contentP);
        
        if (prepend) {
            entriesContainer.prepend(entryDiv);
        } else {
            entriesContainer.appendChild(entryDiv);
        }
    };
    
    // --- Event Listeners ---

    // Handle form submission to save a new entry (MODIFIED)
    textForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = textInput.value.trim();
        const timeFrame = timeFrameSelect.value; // GET NEW FIELD
        
        if (!content) return;
        
        // Stop recording if active before submission
        if (isRecording) recognition.stop();

        try {
            const response = await fetch('/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // SEND NEW FIELD
                body: JSON.stringify({ 
                    content: content,
                    time_frame: timeFrame 
                }),
            });

            if (!response.ok) throw new Error('Failed to save entry.');
            
            const result = await response.json();
            
            if (result.status === 'success') {
                // Only prepend if the new entry matches the current filter (if one is set)
                if (!currentFilter || result.entry.time_frame === currentFilter) {
                    addEntryToDOM(result.entry, true); 
                }
                textInput.value = ''; // Clear the textarea
            } else {
                alert(`Error: ${result.message}`);
            }
        } catch (error) {
            console.error('Error saving entry:', error);
            alert('Could not connect to the server to save your entry.');
        }
    });

    // Handle voice recording button (unchanged)
    recordBtn.addEventListener('click', () => {
        if (!recognition) return;
        isRecording ? recognition.stop() : recognition.start();
    });
    
    // --- Filtering Logic (NEW) ---
    timeFrameFilter.addEventListener('change', () => {
        currentFilter = timeFrameFilter.value;
        entriesContainer.innerHTML = ''; // Clear existing entries
        currentPage = 1; // Reset to page 1
        noMoreEntries = false; // Reset no more entries flag
        loadingIndicator.textContent = "Loading more entries...";
        fetchMoreEntries(); // Load the first page of filtered results
    });

    // --- Pagination: Infinite Scroll (MODIFIED) ---
    const fetchMoreEntries = async () => {
        if (isLoading || noMoreEntries) return;

        isLoading = true;
        loadingIndicator.classList.remove('hidden');

        // Construct the API URL with the current page and filter
        const filterParam = currentFilter ? `&filter=${encodeURIComponent(currentFilter)}` : '';
        const url = `/entries?page=${currentPage}${filterParam}`;
        
        try {
            const response = await fetch(url);
            const newEntries = await response.json();

            if (newEntries.length === 0) {
                noMoreEntries = true; 
                loadingIndicator.textContent = currentPage === 1 ? "No entries found for this time frame." : "You've reached the end!";
            } else {
                newEntries.forEach(entry => addEntryToDOM(entry));
                currentPage++;
                loadingIndicator.classList.add('hidden');
            }
        } catch (error) {
            console.error('Error fetching more entries:', error);
            loadingIndicator.textContent = "Error loading entries.";
        } finally {
            isLoading = false;
        }
    };
    
    // Listen for scroll events to trigger pagination (unchanged, but now uses filter)
    window.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        if (scrollTop + clientHeight >= scrollHeight - 100) {
            fetchMoreEntries();
        }
    });

    // Initial load check for filter (since index() already loads page 1, 
    // we only need to call fetchMoreEntries() if the initial filter is not 'All')
    if (currentFilter) {
        // If an initial filter was set (though usually it's "All"), reload.
        // Since Flask loads page 1, we can rely on scroll or change event for the first real API call.
        // For simplicity, we assume the page starts with 'All Time Frames' (which is loaded by index()).
        // We'll rely on the scroll event for subsequent pages.
        if (entriesContainer.children.length === 0 && !noMoreEntries) {
             // This might happen if the server returns 0 entries for the default filter
            loadingIndicator.textContent = "No entries found yet.";
        }
    }
});
// This file contains JavaScript code that adds interactivity to the web application.
// It handles events, manipulates the DOM, and manages data related to the League of Legends champions.

document.addEventListener('DOMContentLoaded', function() {
    // Fetch champion data from an API or local source
    fetchChampions();

    function fetchChampions() {
        // Example API endpoint (replace with actual endpoint)
        const apiUrl = 'https://api.example.com/lol/champions';

        fetch(apiUrl)
            .then(response => response.json())
            .then(data => {
                displayChampions(data);
            })
            .catch(error => {
                console.error('Error fetching champions:', error);
            });
    }

    function displayChampions(champions) {
        const championsContainer = document.getElementById('champions-container');
        championsContainer.innerHTML = '';

        champions.forEach(champion => {
            const championCard = createChampionCard(champion);
            championsContainer.appendChild(championCard);
        });
    }

    function createChampionCard(champion) {
        const card = document.createElement('div');
        card.className = 'col-md-4 mb-4';

        card.innerHTML = `
            <div class="card">
                <img src="${champion.image}" class="card-img-top" alt="${champion.name}">
                <div class="card-body">
                    <h5 class="card-title">${champion.name}</h5>
                    <p class="card-text">${champion.description}</p>
                    <a href="#" class="btn btn-primary">View Details</a>
                </div>
            </div>
        `;

        return card;
    }
});
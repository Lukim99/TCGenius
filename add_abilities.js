const fs = require('fs');

// Read the JSON file
const data = JSON.parse(fs.readFileSync('DB/TCG/card.json', 'utf8'));

let count = 0;
// Add empty abilities array to cards that don't have it
data.forEach(card => {
    if (!card.abilities) {
        card.abilities = [];
        count++;
    }
});

// Write back to file
fs.writeFileSync('DB/TCG/card.json', JSON.stringify(data, null, 4), 'utf8');

console.log('Added abilities to ' + count + ' cards.');
console.log('Total cards: ' + data.length);

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files (index.html, .well-known, user)
app.use(express.static(path.join(__dirname)));

// Inbox endpoint (ActivityPub POST)
app.post('/inbox', (req, res) => {
    console.log('📩 Received a POST to /inbox:');
    console.log(JSON.stringify(req.body, null, 2));
    res.status(200).send('OK');
});

// Default fallback for 404s
app.use((req, res, next) => {
    res.status(404).send('Not Found');
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});

const express = require('express');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000; // Use the PORT environment variable or default to 3000

const http = require('http');
const privateKey = fs.readFileSync(path.join(__dirname, 'private-key.pem'), 'utf8');
const certificate = fs.readFileSync(path.join(__dirname, 'certificate.pem'), 'utf8');

const credentials = { key: privateKey, cert: certificate };
const httpServer = http.createServer(app);

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static files for user profiles
app.use('/user', express.static(path.join(__dirname, 'user')));

// In-memory storage for followers and activities
const followers = {
  alice: [],
  bob: []
};
const activities = {
  alice: [],
  bob: []
};


// Alice's inbox
app.post('/inbox/alice', (req, res) => {
  const activity = req.body;
  console.log('Message received for Alice:', activity);

  // Save the message to Alice's inbox directory
  const aliceInboxDir = path.join(__dirname, 'inbox', 'alice');
  if (!fs.existsSync(aliceInboxDir)) {
    fs.mkdirSync(aliceInboxDir, { recursive: true });
  }

  const messageFile = path.join(aliceInboxDir, `${Date.now()}.json`);
  fs.writeFileSync(messageFile, JSON.stringify(activity, null, 2));

  res.status(200).json({ status: 'Message received and saved for Alice' });
});

// Bob's inbox
app.post('/inbox/bob', (req, res) => {
  const activity = req.body;
  console.log('Message received for Bob:', activity);

  // Save the message to Bob's inbox directory
  const bobInboxDir = path.join(__dirname, 'inbox', 'bob');
  if (!fs.existsSync(bobInboxDir)) {
    fs.mkdirSync(bobInboxDir, { recursive: true });
  }

  const messageFile = path.join(bobInboxDir, `${Date.now()}.json`);
  fs.writeFileSync(messageFile, JSON.stringify(activity, null, 2));

  res.status(200).json({ status: 'Message received and saved for Bob' });
});

// Outbox for Alice
app.get('/outbox/alice', (req, res) => {
    console.log('Serving Alice\'s outbox:', activities.alice);
    res.json({
        "@context": "https://www.w3.org/ns/activitystreams",
        "id": "http://localhost:${port}/outbox/alice",
        "type": "OrderedCollection",
        "totalItems": activities.alice.length,
        "orderedItems": activities.alice
    });
});

// Outbox for Bob
app.get('/outbox/bob', (req, res) => {
    console.log('Serving Bob\'s outbox:', activities.bob);
    res.json({
        "@context": "https://www.w3.org/ns/activitystreams",
        "id": "http://localhost:${port}/outbox/bob",
        "type": "OrderedCollection",
        "totalItems": activities.bob.length,
        "orderedItems": activities.bob
    });
});

// Followers endpoint for Alice
app.get('/user/alice/followers', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": "http://localhost:${port}/user/alice/followers",
    "type": "OrderedCollection",
    "totalItems": followers.alice.length,
    "orderedItems": followers.alice
  });
});

// Followers endpoint for Bob
app.get('/user/bob/followers', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": "http://localhost:${port}/user/bob/followers",
    "type": "OrderedCollection",
    "totalItems": followers.bob.length,
    "orderedItems": followers.bob
  });
});

// WebFinger endpoint
app.get('/.well-known/webfinger', (req, res) => {
  const resource = req.query.resource;

  if (resource === 'acct:alice@localhost:${port}') {
    res.json({
      subject: 'acct:alice@localhost:${port}',
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: 'http://localhost:${port}/user/alice'
        }
      ]
    });
  } else if (resource === 'acct:bob@localhost:${port}') {
    res.json({
      subject: 'acct:bob@localhost:${port}',
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: 'http://localhost:${port}/user/bob'
        }
      ]
    });
  } else {
    res.status(404).send('Not Found');
  }
});


// Send Message Endpoint
app.post('/send-message', (req, res) => {
    const { sender, recipient, content } = req.body;

    if (!sender || !recipient || !content) {
        return res.status(400).json({ error: 'Missing sender, recipient, or content' });
    }

    // Determine the recipient's inbox
    let recipientInbox;
    if (recipient === 'Bob') {
        recipientInbox = `https://localhost:${port}/inbox/bob`; // Use template literal
    } else if (recipient === 'Alice') {
        recipientInbox = `https://localhost:${port}/inbox/alice`; // Use template literal
    } else {
        return res.status(404).json({ error: 'Recipient not found' });
    }

    // Create the activity object
    const activity = {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Create",
        "actor": `http://localhost:${port}/user/${sender.toLowerCase()}`,
        "object": {
            "type": "Note",
            "content": content,
            "to": [`http://localhost:${port}/user/${recipient.toLowerCase()}`]
        }
    };

    // Add the activity to the sender's outbox
    if (sender.toLowerCase() === 'alice') {
        activities.alice.push(activity);
        console.log('Activity added to Alice\'s outbox:', activities.alice);

        // Save the activity to Alice's outbox directory
        const aliceOutboxDir = path.join(__dirname, 'outbox', 'alice');
        if (!fs.existsSync(aliceOutboxDir)) {
            fs.mkdirSync(aliceOutboxDir, { recursive: true });
        }

        const activityFile = path.join(aliceOutboxDir, `${Date.now()}.json`);
        fs.writeFileSync(activityFile, JSON.stringify(activity, null, 2));
    } else if (sender.toLowerCase() === 'bob') {
        activities.bob.push(activity);
        console.log('Activity added to Bob\'s outbox:', activities.bob);

        // Save the activity to Bob's outbox directory
        const bobOutboxDir = path.join(__dirname, 'outbox', 'bob');
        if (!fs.existsSync(bobOutboxDir)) {
            fs.mkdirSync(bobOutboxDir, { recursive: true });
        }

        const activityFile = path.join(bobOutboxDir, `${Date.now()}.json`);
        fs.writeFileSync(activityFile, JSON.stringify(activity, null, 2));
    }

    // Send the message to the recipient's inbox
    fetch(recipientInbox, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activity),
        agent: new https.Agent({ rejectUnauthorized: false }) // Skip certificate verification for self-signed certs
    })
        .then(response => {
            if (response.ok) {
                res.status(200).json({ status: 'Message sent successfully' });
            } else {
                res.status(response.status).json({ error: 'Failed to send message' });
            }
        })
        .catch(error => {
            console.error('Error sending message:', error);
            res.status(500).json({ error: 'Internal server error' });
        });
});

// Following endpoint for Alice
app.get('/user/alice/following', (req, res) => {
    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      "id": "http://localhost:${port}/user/alice/following",
      "type": "OrderedCollection",
      "totalItems": 0,
      "orderedItems": [] // Add actual following data here
    });
  });
  
  // Following endpoint for Bob
  app.get('/user/bob/following', (req, res) => {
    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      "id": "http://localhost:${port}/user/bob/following",
      "type": "OrderedCollection",
      "totalItems": 0,
      "orderedItems": [] // Add actual following data here
    });
 });

app.post('/follow', (req, res) => {
    const { actor, target } = req.body;
  
    if (!actor || !target) {
      return res.status(400).json({ error: 'Missing actor or target' });
    }
  
    // Add the target to the actor's following list
    if (actor === 'http://localhost:${port}/user/alice') {
      followers.bob.push(actor); // Bob gains a follower
      console.log('Alice is now following Bob');
    } else if (actor === 'http://localhost:${port}/user/bob') {
      followers.alice.push(actor); // Alice gains a follower
      console.log('Bob is now following Alice');
    }
  
    res.status(200).json({ status: 'Follow activity processed' });
  });

app.post('/like', (req, res) => {
    const { actor, object } = req.body;
  
    if (!actor || !object) {
      return res.status(400).json({ error: 'Missing actor or object' });
    }
  
    console.log(`${actor} liked ${object}`);
    res.status(200).json({ status: 'Like activity processed' });
 });

 app.get('/', (req, res) => {
    res.send('Welcome to Grassroots ActivityPub server!');
  });
  
  
// Start the server
httpServer.listen(port, () => {
    console.log(`HTTP Server running on port ${port}`);
});
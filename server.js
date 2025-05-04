const express = require('express');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const https = require('https'); // Add this since it's used in fetch

const app = express();
const port = process.env.PORT || 3000;

// SSL certs (you can skip this on Render unless used locally)
const privateKey = fs.readFileSync(path.join(__dirname, 'private-key.pem'), 'utf8');
const certificate = fs.readFileSync(path.join(__dirname, 'certificate.pem'), 'utf8');
const credentials = { key: privateKey, cert: certificate };
const http = require('http');
const httpServer = http.createServer(app);

app.use(bodyParser.json());

// Serve static profiles
app.use('/user', express.static(path.join(__dirname, 'user')));

// ✅ Explicit route for Alice JSON
app.get('/user/alice', (req, res) => {
  res.sendFile(path.join(__dirname, 'user', 'alice', 'index.json'));
});
// ✅ Explicit route for Bob JSON
app.get('/user/bob', (req, res) => {
  res.sendFile(path.join(__dirname, 'user', 'bob', 'index.json'));
});

const followers = { alice: [], bob: [] };
const activities = { alice: [], bob: [] };

app.post('/inbox/alice', (req, res) => {
  const activity = req.body;
  console.log('Message received for Alice:', activity);

  const dir = path.join(__dirname, 'inbox', 'alice');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));
  res.status(200).json({ status: 'Message received and saved for Alice' });
});

app.post('/inbox/bob', (req, res) => {
  const activity = req.body;
  console.log('Message received for Bob:', activity);

  const dir = path.join(__dirname, 'inbox', 'bob');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));
  res.status(200).json({ status: 'Message received and saved for Bob' });
});

app.get('/outbox/alice', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": "https://grassrootsactivitypub2.onrender.com/outbox/alice",
    "type": "OrderedCollection",
    "totalItems": activities.alice.length,
    "orderedItems": activities.alice
  });
});

app.get('/outbox/bob', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": "https://grassrootsactivitypub2.onrender.com/outbox/bob",
    "type": "OrderedCollection",
    "totalItems": activities.bob.length,
    "orderedItems": activities.bob
  });
});

app.get('/user/alice/followers', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": "https://grassrootsactivitypub2.onrender.com/user/alice/followers",
    "type": "OrderedCollection",
    "totalItems": followers.alice.length,
    "orderedItems": followers.alice
  });
});

app.get('/user/bob/followers', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": "https://grassrootsactivitypub2.onrender.com/user/bob/followers",
    "type": "OrderedCollection",
    "totalItems": followers.bob.length,
    "orderedItems": followers.bob
  });
});

app.get('/.well-known/webfinger', (req, res) => {
  const resource = req.query.resource;
  const base = 'https://grassrootsactivitypub2.onrender.com';

  if (resource === 'acct:alice@grassrootsactivitypub2.onrender.com') {
    res.json({
      subject: resource,
      links: [{
        rel: 'self',
        type: 'application/activity+json',
        href: `${base}/user/alice`
      }]
    });
  } else if (resource === 'acct:bob@grassrootsactivitypub2.onrender.com') {
    res.json({
      subject: resource,
      links: [{
        rel: 'self',
        type: 'application/activity+json',
        href: `${base}/user/bob`
      }]
    });
  } else {
    res.status(404).send('Not Found');
  }
});

app.post('/send-message', (req, res) => {
    console.log('✅ /send-message received a request');
  
    const { sender, recipient, content } = req.body;
    const base = 'https://grassrootsactivitypub2.onrender.com';
  
    if (!sender || !recipient || !content) {
      return res.status(400).json({ error: 'Missing sender, recipient, or content' });
    }
  
    const actor = `${base}/user/${sender.toLowerCase()}`;
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "actor": actor,
      "object": {
        "type": "Note",
        "content": content,
        "to": [`${base}/user/${recipient.toLowerCase()}`]
      }
    };
  
    // Save to outbox
    const outboxDir = path.join(__dirname, 'outbox', sender.toLowerCase());
    if (!fs.existsSync(outboxDir)) fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));
  
    if (sender.toLowerCase() === 'alice') {
      activities.alice.push(activity);
    } else if (sender.toLowerCase() === 'bob') {
      activities.bob.push(activity);
    }
  
    // 🚫 No external fetch — write directly to inbox
    const inboxDir = path.join(__dirname, 'inbox', recipient.toLowerCase());
    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));
    console.log(`📥 Message saved to ${recipient}'s inbox`);
  
    res.status(200).json({ status: 'Message sent successfully' });
  });

app.get('/user/alice/following', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": "https://grassrootsactivitypub2.onrender.com/user/alice/following",
    "type": "OrderedCollection",
    "totalItems": 0,
    "orderedItems": []
  });
});

app.get('/user/bob/following', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": "https://grassrootsactivitypub2.onrender.com/user/bob/following",
    "type": "OrderedCollection",
    "totalItems": 0,
    "orderedItems": []
  });
});

app.post('/follow', (req, res) => {
  const { actor, target } = req.body;

  if (!actor || !target) {
    return res.status(400).json({ error: 'Missing actor or target' });
  }

  if (actor === 'https://grassrootsactivitypub2.onrender.com/user/alice') {
    followers.bob.push(actor);
  } else if (actor === 'https://grassrootsactivitypub2.onrender.com/user/bob') {
    followers.alice.push(actor);
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

app.listen(port, () => {
    console.log(`✅ Express server running on port ${port}`);
  });
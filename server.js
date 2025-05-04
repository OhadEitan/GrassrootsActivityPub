const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const base = 'https://grassrootsactivitypub2.onrender.com';

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Serve static profiles
app.use('/user', express.static(path.join(__dirname, 'user')));

// Explicit route for Alice JSON
app.get('/user/alice', (req, res) => {
  res.sendFile(path.join(__dirname, 'user', 'alice', 'index.json'));
});

// Explicit route for Bob JSON
app.get('/user/bob', (req, res) => {
  res.sendFile(path.join(__dirname, 'user', 'bob', 'index.json'));
});

const followers = { alice: [], bob: [] };
const activities = { alice: [], bob: [] };

// Inbox endpoints
app.post('/inbox/alice', (req, res) => {
  console.log('📥 Message received for Alice');
  const activity = req.body;
  const dir = path.join(__dirname, 'inbox', 'alice');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));
  res.status(200).json({ status: 'Message saved for Alice' });
});

app.post('/inbox/bob', (req, res) => {
  console.log('📥 Message received for Bob');
  const activity = req.body;
  const dir = path.join(__dirname, 'inbox', 'bob');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));
  res.status(200).json({ status: 'Message saved for Bob' });
});

// Outbox endpoints
app.get('/outbox/alice', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `${base}/outbox/alice`,
    "type": "OrderedCollection",
    "totalItems": activities.alice.length,
    "orderedItems": activities.alice
  });
});

app.get('/outbox/bob', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `${base}/outbox/bob`,
    "type": "OrderedCollection",
    "totalItems": activities.bob.length,
    "orderedItems": activities.bob
  });
});

// Followers
app.get('/user/alice/followers', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `${base}/user/alice/followers`,
    "type": "OrderedCollection",
    "totalItems": followers.alice.length,
    "orderedItems": followers.alice
  });
});

app.get('/user/bob/followers', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `${base}/user/bob/followers`,
    "type": "OrderedCollection",
    "totalItems": followers.bob.length,
    "orderedItems": followers.bob
  });
});

// Following
app.get('/user/alice/following', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `${base}/user/alice/following`,
    "type": "OrderedCollection",
    "totalItems": 0,
    "orderedItems": []
  });
});

app.get('/user/bob/following', (req, res) => {
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `${base}/user/bob/following`,
    "type": "OrderedCollection",
    "totalItems": 0,
    "orderedItems": []
  });
});

// Send message
app.post('/send-message', (req, res) => {
  console.log('✅ /send-message endpoint hit');
  const { sender, recipient, content } = req.body;

  if (!sender || !recipient || !content) {
    console.log('❌ Missing fields in message');
    return res.status(400).json({ error: 'Missing sender, recipient, or content' });
  }

  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Create",
    "actor": `${base}/user/${sender.toLowerCase()}`,
    "object": {
      "type": "Note",
      "content": content,
      "to": [`${base}/user/${recipient.toLowerCase()}`]
    }
  };

  // Save to sender's outbox
  const outboxDir = path.join(__dirname, 'outbox', sender.toLowerCase());
  if (!fs.existsSync(outboxDir)) fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(path.join(outboxDir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));

  if (sender.toLowerCase() === 'alice') {
    activities.alice.push(activity);
  } else if (sender.toLowerCase() === 'bob') {
    activities.bob.push(activity);
  }

  // Save to recipient's inbox (no fetch!)
  const inboxDir = path.join(__dirname, 'inbox', recipient.toLowerCase());
  if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(path.join(inboxDir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));

  console.log(`📬 Message from ${sender} to ${recipient} saved`);
  res.status(200).json({ status: 'Message sent successfully' });
});

// Follow
app.post('/follow', (req, res) => {
  const { actor, target } = req.body;
  if (!actor || !target) {
    return res.status(400).json({ error: 'Missing actor or target' });
  }

  if (actor.includes('/alice')) followers.bob.push(actor);
  else if (actor.includes('/bob')) followers.alice.push(actor);

  res.status(200).json({ status: 'Follow activity processed' });
});

// Like
app.post('/like', (req, res) => {
  const { actor, object } = req.body;
  if (!actor || !object) {
    return res.status(400).json({ error: 'Missing actor or object' });
  }
  console.log(`${actor} liked ${object}`);
  res.status(200).json({ status: 'Like activity processed' });
});

// Root
app.get('/', (req, res) => {
  res.send('✅ Grassroots ActivityPub server is running');
});

// Start server (Render-friendly)
app.listen(port, () => {
  console.log(`✅ Express server running on port ${port}`);
});

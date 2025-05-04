const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const base = 'https://grassrootsactivitypub2.onrender.com';
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const privateKey = fs.readFileSync(path.join(__dirname, 'private-key.pem'), 'utf8');


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

app.get('/user/:username', (req, res) => {
    const profilePath = path.join(__dirname, 'user', req.params.username, 'index.json');
    if (fs.existsSync(profilePath)) {
      res.sendFile(profilePath);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });

const followers = { alice: [], bob: [] };
const activities = { alice: [], bob: [] };

function createHTTPSignature({ privateKey, keyId, headers }) {
  const signer = crypto.createSign('RSA-SHA256');

  const signatureHeaders = [
    `(request-target): post /inbox/${headers.recipient}`,
    `host: grassrootsactivitypub2.onrender.com`,
    `date: ${headers.date}`,
    `digest: ${headers.digest}`
  ].join('\n');

  signer.update(signatureHeaders);
  signer.end();

  const signature = signer.sign(privateKey, 'base64');

  return `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`;
}

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

app.post('/create-user/:username', (req, res) => {
    const username = req.params.username.toLowerCase();
    const userDir = path.join(__dirname, 'user', username);
    const inboxDir = path.join(__dirname, 'inbox', username);
    const outboxDir = path.join(__dirname, 'outbox', username);
  
    if (fs.existsSync(userDir)) {
      return res.status(400).json({ error: `User '${username}' already exists.` });
    }
  
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.mkdirSync(outboxDir, { recursive: true });
  
    const profile = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "id": `${base}/user/${username}`,
      "type": "Person",
      "preferredUsername": username,
      "inbox": `${base}/inbox/${username}`,
      "outbox": `${base}/outbox/${username}`,
      "followers": `${base}/user/${username}/followers`,
      "following": `${base}/user/${username}/following`,
      "publicKey": {
        "id": `${base}/user/${username}#main-key`,
        "owner": `${base}/user/${username}`,
        "publicKeyPem": "YOUR PUBLIC KEY HERE"
      }
    };
  
    fs.writeFileSync(path.join(userDir, 'index.json'), JSON.stringify(profile, null, 2));
    console.log(`🧑‍💻 Created user '${username}'`);
    res.status(201).json({ status: `User '${username}' created` });
  });

app.get('/inbox/:username', (req, res) => {
    const username = req.params.username.toLowerCase();
    const inboxDir = path.join(__dirname, 'inbox', username);

    if (!fs.existsSync(inboxDir)) {
        return res.status(404).json({ error: `Inbox for user '${username}' not found.` });
    }

    const files = fs.readdirSync(inboxDir).sort();
    const messages = files.map(filename => {
        const content = fs.readFileSync(path.join(inboxDir, filename));
        return JSON.parse(content);
    });

    res.json(messages);
    });

app.get('/outbox/:username', (req, res) => {
        const username = req.params.username.toLowerCase();
        const outboxDir = path.join(__dirname, 'outbox', username);
      
        if (!fs.existsSync(outboxDir)) {
          return res.status(404).json({ error: `Outbox for user '${username}' not found.` });
        }
      
        const files = fs.readdirSync(outboxDir).sort();
        const messages = files.map(filename => {
          const content = fs.readFileSync(path.join(outboxDir, filename));
          return JSON.parse(content);
        });
      
        res.json(messages);
      });

// Send message
app.post('/send-message', async (req, res) => {
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
  
    if (sender.toLowerCase() === 'alice') activities.alice.push(activity);
    if (sender.toLowerCase() === 'bob') activities.bob.push(activity);
  
    // Prepare HTTP Signature headers
    const inboxPath = `/inbox/${recipient.toLowerCase()}`;
    const inboxUrl = `${base}${inboxPath}`;
    const date = new Date().toUTCString();
    const digest = `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(activity)).digest('base64')}`;
    const keyId = `${base}/user/${sender.toLowerCase()}#main-key`;
  
    const signatureHeader = createHTTPSignature({
      privateKey,
      keyId,
      headers: { recipient, date, digest }
    });
    console.log('📦 Signature Header:', signatureHeader);
    const headers = {
        'Host': 'grassrootsactivitypub2.onrender.com',
        'Date': date,
        'Digest': digest,
        'Content-Type': 'application/json',
        'Signature': signatureHeader
      };
      
    console.log('🧾 Full headers being sent to inbox:');
    console.log(headers);

    try {
      const response = await fetch(inboxUrl, {
        method: 'POST',
        headers: {
          'Host': 'grassrootsactivitypub2.onrender.com',
          'Date': date,
          'Digest': digest,
          'Content-Type': 'application/json',
          'Signature': signatureHeader
        },
        body: JSON.stringify(activity)
      });
  
      if (response.ok) {
        console.log(`📬 Message from ${sender} to ${recipient} sent and signed`);
        res.status(200).json({ status: 'Message sent and signed successfully' });
      } else {
        console.error(`❌ Failed to deliver message: HTTP ${response.status}`);
        res.status(response.status).json({ error: 'Failed to deliver message' });
      }
    } catch (err) {
      console.error('🚨 Signature delivery error:', err);
      res.status(500).json({ error: 'Failed to send signed message' });
    }
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

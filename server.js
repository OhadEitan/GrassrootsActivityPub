const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const port = process.env.PORT || 3000;
const base = 'https://grassrootsactivitypub2.onrender.com';

async function authenticateUser(username, password) {
  const passPath = path.join(__dirname, 'user', username, 'password.txt');
  if (!fs.existsSync(passPath)) return false;
  if (!password) return false; // <-- Add this check

  const hashed = fs.readFileSync(passPath, 'utf8');
  if (!hashed) return false;  // <-- Optional sanity check

  return await bcrypt.compare(password, hashed);
}

app.use(bodyParser.json());
app.use(express.static(__dirname));

app.use('/user', express.static(path.join(__dirname, 'user')));

const followers = {};
const activities = {};


function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });

  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}


function createHTTPSignature({ privateKey, keyId, headers }) {
  const signer = crypto.createSign('RSA-SHA256');
  const signatureHeaders = [
    `(request-target): post /inbox/${headers.recipient}`,
    `host: grassrootsactivitypub2.onrender.com`,
    `date: ${headers.date}`,
    `digest: ${headers.digest}`
  ].join('\n');
  console.log(`Headers to be signed:\n${signatureHeaders}\n`);


  signer.update(signatureHeaders);
  signer.end();

  const signature = signer.sign(privateKey, 'base64');
  console.log(`🔏 Final Signature: \n${signature}\n`);
  return `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`;

}


function encryptMessage(publicKeyPem, message) {
  const bufferMessage = Buffer.from(message, 'utf8');
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    bufferMessage
  );
    return encrypted.toString('base64');
}

function decryptMessage(privateKeyPem, encryptedMessage) {
  const bufferEncrypted = Buffer.from(encryptedMessage, 'base64');
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    bufferEncrypted
  );
  return decrypted.toString('utf8');
}

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!await authenticateUser(username, password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});

app.get('/user/:username', (req, res) => {
  const profilePath = path.join(__dirname, 'user', req.params.username.toLowerCase(), 'index.json');
  if (fs.existsSync(profilePath)) {
    res.sendFile(profilePath);
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});



app.post('/create-user/:username', async (req, res) => {
  const username = req.params.username.toLowerCase();
  const password = req.body.password;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const userDir = path.join(__dirname, 'user', username);
  const inboxDir = path.join(__dirname, 'inbox', username);
  const outboxDir = path.join(__dirname, 'outbox', username);


  if (fs.existsSync(userDir)) {
    return res.status(400).json({ error: `User '${username}' already exists.` });
  }

  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(outboxDir, { recursive: true });

  const hashedPassword = await bcrypt.hash(password, 10);
  fs.writeFileSync(path.join(userDir, 'password.txt'), hashedPassword);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  fs.writeFileSync(path.join(userDir, 'public-key.pem'), publicKey);
  fs.writeFileSync(path.join(userDir, 'private-key.pem'), privateKey);

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
      "publicKeyPem": publicKey
    }
  };

  fs.writeFileSync(path.join(userDir, 'index.json'), JSON.stringify(profile, null, 2));

  followers[username] = [];
  activities[username] = [];

  res.status(201).json({ status: `User '${username}' created successfully` });
});

app.get('/inbox/:username', verifyToken, async (req, res) => {
  const username = req.params.username.toLowerCase();
  if (req.user.username !== username) return res.status(403).json({ error: 'Forbidden' });

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

app.post('/inbox/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  const activity = req.body;
  const dir = path.join(__dirname, 'inbox', username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));
  res.status(200).json({ status: `Message saved for ${username}` });
});

app.get('/outbox/:username', verifyToken, async (req, res) => {
  const username = req.params.username.toLowerCase();

  if (req.user.username !== username) return res.status(403).json({ error: 'Forbidden' });
  
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

app.get('/user/:username/followers', verifyToken, async (req, res) => {
  const username = req.params.username.toLowerCase();
  if (req.user.username !== username) return res.status(403).json({ error: 'Forbidden' });

  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `${base}/user/${username}/followers`,
    "type": "OrderedCollection",
    "totalItems": followers[username]?.length || 0,
    "orderedItems": followers[username] || []
  });
});

app.get('/user/:username/following', verifyToken, async (req, res) => {
  const username = req.params.username.toLowerCase();
  if (req.user.username !== username) return res.status(403).json({ error: 'Forbidden' });

  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `${base}/user/${username}/following`,
    "type": "OrderedCollection",
    "totalItems": 0,
    "orderedItems": []
  });
});

app.post('/send-message', async (req, res) => {
  const { sender, recipient, content, block } = req.body;

  if (!sender || !recipient || (!content && !block)) {
    return res.status(400).json({ error: 'Missing sender, recipient, or content/block' });
  }

  // Determine what to use for the message
  const messageObject = block || content;
  const isObjectContent = typeof messageObject === 'object' && messageObject !== null;

  const activity = {
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "actor": `${base}/user/${sender.toLowerCase()}`,
  "published": new Date().toISOString(),
  "object": {
    "type": "Note",
    "content": isObjectContent ? JSON.stringify(messageObject) : messageObject,
    "to": [`${base}/user/${recipient.toLowerCase()}`]
  }
  };
 

  const outboxDir = path.join(__dirname, 'outbox', sender.toLowerCase());
  if (!fs.existsSync(outboxDir)) fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(path.join(outboxDir, `${Date.now()}.json`), JSON.stringify(activity, null, 2));
  if (!activities[sender.toLowerCase()]) activities[sender.toLowerCase()] = [];
  activities[sender.toLowerCase()].push(activity);

  const recipientKeyPath = path.join(__dirname, 'user', recipient.toLowerCase(), 'public-key.pem');
  if (!fs.existsSync(recipientKeyPath)) {
    return res.status(404).json({ error: `Public key for ${recipient} not found` });
  }

  
  const recipientPublicKey = fs.readFileSync(recipientKeyPath, 'utf8');

  console.log(`🔐 Public key used for encryption (${recipient}):\n${recipientPublicKey}`);
  const messageToEncrypt = isObjectContent ? JSON.stringify(messageObject) : messageObject;
  console.log(`✉️ Message to encrypt: "${messageToEncrypt}"`);
  const encryptedMessage = encryptMessage(recipientPublicKey, messageToEncrypt);

  const inboxUrl = `${base}/inbox/${recipient.toLowerCase()}`;
  const date = new Date().toUTCString();
  const digest = `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(activity)).digest('base64')}`;
  const keyId = `${base}/user/${sender.toLowerCase()}#main-key`;
  const senderPrivKeyPath = path.join(__dirname, 'user', sender.toLowerCase(), 'private-key.pem');
  if (!fs.existsSync(senderPrivKeyPath)) {
    return res.status(404).json({ error: `Private key for ${sender} not found` });
  }
  const senderPrivateKey = fs.readFileSync(senderPrivKeyPath, 'utf8');
  
  const signatureHeader = createHTTPSignature({
    privateKey: senderPrivateKey,
    keyId,
    headers: { recipient, date, digest }
  });

  const headers = {
    'Host': 'grassrootsactivitypub2.onrender.com',
    'Date': date,
    'Digest': digest,
    'Content-Type': 'application/json',
    'Signature': signatureHeader
  };

  try {
    const response = await fetch(inboxUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(activity)
    });

    const inboxDir = path.join(__dirname, 'inbox', recipient.toLowerCase());
    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, `${Date.now()}.json`), JSON.stringify({ encryptedMessage }, null, 2));

    if (response.ok) {
      res.status(200).json({
        status: 'Message sent and encrypted successfully',
        sentAt: new Date().toISOString(),
        plaintext: content
      });
    } else {
      const errorText = await response.text();
      res.status(response.status).json({ error: 'Failed to deliver message', details: errorText });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to send signed message', details: err.message });
  }
});

app.get('/decrypt/:username', verifyToken, async (req, res) => {
  const username = req.params.username.toLowerCase();
  if (req.user.username !== username) return res.status(403).json({ error: 'Forbidden' });

  const inboxDir = path.join(__dirname, 'inbox', username);
  const privateKeyPath = path.join(__dirname, 'user', username, 'private-key.pem');

  if (!fs.existsSync(inboxDir) || !fs.existsSync(privateKeyPath)) {
    return res.status(404).json({ error: 'Inbox or private key not found.' });
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const files = fs.readdirSync(inboxDir).sort();
  const decryptedMessages = files.map(filename => {
    const content = fs.readFileSync(path.join(inboxDir, filename));
    const { encryptedMessage } = JSON.parse(content);
    const decrypted = decryptMessage(privateKeyPem, encryptedMessage);
    return { filename, decrypted };
  });

  res.json(decryptedMessages);
});

app.post('/follow', (req, res) => {
  const { actor, target } = req.body;
  if (!actor || !target) {
    return res.status(400).json({ error: 'Missing actor or target' });
  }

  const actorName = actor.split('/').pop();
  const targetName = target.split('/').pop();

  if (!followers[targetName]) followers[targetName] = [];
  followers[targetName].push(actor);

  res.status(200).json({ status: 'Follow activity processed' });
});

app.post('/like', (req, res) => {
  const { actor, object } = req.body;
  if (!actor || !object) {
    return res.status(400).json({ error: 'Missing actor or object' });
  }
  res.status(200).json({ status: 'Like activity processed' });
});

app.get('/', (req, res) => {
  res.send('✅ Grassroots ActivityPub server is running');
});

app.listen(port, () => {
  console.log(`✅ Express server running on port ${port}`);
});

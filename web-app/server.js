const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const CONFIG_PATH = path.join(__dirname, '..', 'mcp-config.json');
const PORT = 3000;

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ servers: [] }, null, 2));
  }
  const data = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(data);
}

function writeConfig(cfg) {
  const backup = CONFIG_PATH + '.bak';
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, backup);
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

app.get('/api/mcp-config', (req, res) => {
  try {
    res.json(readConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mcp-config', (req, res) => {
  try {
    const cfg = readConfig();
    const server = req.body;
    if (!server.name) {
      return res.status(400).json({ error: 'Server must have a name' });
    }
    const idx = cfg.servers.findIndex(s => s.name === server.name);
    if (idx !== -1) {
      cfg.servers[idx] = server;
    } else {
      cfg.servers.push(server);
    }
    writeConfig(cfg);
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mcp-config/:name', (req, res) => {
  try {
    const cfg = readConfig();
    cfg.servers = cfg.servers.filter(s => s.name !== req.params.name);
    writeConfig(cfg);
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

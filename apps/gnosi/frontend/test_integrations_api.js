const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5002, // assuming backend is on 5002
  path: '/api/integrations',
  method: 'GET'
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log("INTEGRATIONS FROM API: ", data);
  });
});

req.on('error', e => {
  console.error("error: " + e.message);
});

req.end();

#!/usr/bin/env node
/**
 * Export OpenAPI schema to a static file
 * This allows you to copy/paste the schema into Custom GPT actions
 * or import it from a URL if you're running the server with ngrok/similar
 */

const fs = require('fs');
let yaml;
try {
  yaml = require('js-yaml');
} catch (err) {
  // js-yaml is optional
}

const { getOpenApiSpec } = require('./openapi');
const serverUrl = process.argv[2] || 'http://localhost:3000';
const openApiSpec = getOpenApiSpec(serverUrl);

// Export as JSON
fs.writeFileSync('openapi.json', JSON.stringify(openApiSpec, null, 2));
console.log('✓ Exported to openapi.json');

// Export as YAML if js-yaml is available
if (yaml) {
  try {
    const yamlStr = yaml.dump(openApiSpec, { lineWidth: -1 });
    fs.writeFileSync('openapi.yaml', yamlStr);
    console.log('✓ Exported to openapi.yaml');
  } catch (err) {
    console.log('⚠ YAML export failed:', err.message);
  }
} else {
  console.log('⚠ YAML export skipped (install js-yaml for YAML export: npm install js-yaml)');
}

console.log('\nYou can now:');
console.log('1. Copy the contents of openapi.json or openapi.yaml');
console.log('2. Paste into Custom GPT Actions');
console.log('3. Or use with: Import from URL → your-server-url/openapi.json');
console.log(`\nCurrent server URL in schema: ${serverUrl}`);
console.log('To change URL: node export-openapi.js https://your-url.com');

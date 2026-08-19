// Assert-based self-check. Run with: node client/src/nodes/fieldResize.test.js
import assert from 'node:assert/strict';
import { resizedSize } from './fieldResize.js';

// Nothing stored yet, and a real resize: writes the new size.
{
  const style = { width: '400px', height: '200px' };
  assert.deepEqual(resizedSize(style, undefined), { width: '400px', height: '200px' });
}

// The same size already stored is a no-op -- a plain click costs no save.
{
  const style = { width: '400px', height: '200px' };
  const current = { width: '400px', height: '200px' };
  assert.equal(resizedSize(style, current), null);
}

// No inline width/height at all: this element was never resized.
{
  assert.equal(resizedSize({}, { width: '400px', height: '200px' }), null);
}

// A changed width alone, height unchanged, still writes.
{
  const style = { width: '500px', height: '200px' };
  const current = { width: '400px', height: '200px' };
  assert.deepEqual(resizedSize(style, current), { width: '500px', height: '200px' });
}

console.log('fieldResize.test.js ok');

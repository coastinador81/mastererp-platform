import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCursorPages,collectOffsetPages} from './operationPages.mjs';

test('collects every offset page without truncating the directory',async()=>{
  const rows=await collectOffsetPages(async offset=>offset===0?{items:[1,2],next_offset:2}:{items:[3],next_offset:null},2);
  assert.deepEqual(rows,[1,2,3]);
});

test('collects every cursor page without truncating orders',async()=>{
  const rows=await collectCursorPages(async cursor=>cursor?{items:[2],next_cursor:null}:{items:[1],next_cursor:'next'});
  assert.deepEqual(rows,[1,2]);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '../delivery-approval/Prepare-Repeat-Approval-170.ps1');

test('170 preparer is a new package-bound template and pins only versioned reviewer files', () => {
  assert.equal(fs.existsSync(file), true, 'new 1.7 preparer source is required');
  const source = fs.readFileSync(file, 'utf8');
  for (const name of ['Prepare-Repeat-Approval-170.ps1', 'approval-core-170.cjs', 'approval-archive-170.cjs', 'approval-io-170.cjs']) assert(source.includes(name));
  assert(source.includes('__XJY_170_ARCHIVE_SHA256__'));
  assert(source.includes('__XJY_170_PUBLICATION_SHA256__'));
  assert(!source.includes('8b829f7c46e2e4b45d1553da2a47a876c49b4d7f12c1babfe87c8cc1a7f77bd4'));
  assert(!source.includes('鑫金源珠宝1.6.0完整升级补丁.zip'));
});

test('170 one-click candidate inputs remain hints and are pinned before review, with role locked to the selected candidate', () => {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /CandidateExecutable/);
  assert.match(source, /CandidateRole/);
  assert.match(source, /Pin-File\s+\$exe/);
  assert.match(source, /Run-Review\s+\$exe\s+\$entry\s+\$request/);
  assert.match(source, /\$role\.Enabled\s*=\s*\$false/);
  assert.match(source, /Get-FixedApprovalRoot\s+\$common\s+\$sid\s+\$publicationId/);
  assert.doesNotMatch(source, /F:\\自制软件\\xjy-jewelry-offline/);
  const io = fs.readFileSync(path.resolve(__dirname, '../delivery-approval/approval-io-170.cjs'), 'utf8');
  assert.match(io, /validateActivationRecord\(activation/);
  assert.match(io, /activation\.role!==role/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesSearch,normalizeSearch,oneEditApart,searchTerms} from '../src/search';

test('search folds width, case and accents and requires all terms across fields',()=>{
  assert.equal(normalizeSearch('ＶＰＳ Café'),'vps cafe');
  assert.deepEqual(searchTerms('香港，ＶＰＳ、Café\n美国'),['香港','vps','cafe','美国']);
  assert.equal(matchesSearch('香港 ＣＡＦＥ',['香港机房','Café VPS']),true);
  assert.equal(matchesSearch('香港 美国',['香港机房','Café VPS']),false);
  assert.equal(matchesSearch('',[]),true);
  assert.equal(searchTerms(Array.from({length:20},(_,index)=>'t'+index).join(',')).length,12);
});
test('Latin terms allow one insertion, deletion, substitution or adjacent transposition',()=>{
  for(const typo of ['nodeseek','nodseek','nodesseek','nodeseel','nodeseek','nodeseke'])assert.equal(matchesSearch(typo,['NodeSeek VPS']),true,typo);
  assert.equal(matchesSearch('香港 nodseek',['香港机房','NodeSeek']),true);
  assert.equal(matchesSearch('nodseeq',['NodeSeek']),false);
  assert.equal(matchesSearch('nodese',['node-seek']),false);
  assert.equal(oneEditApart('seek','seke'),true);assert.equal(oneEditApart('seek','skse'),false);
});
test('short, Chinese and excessively long terms use exact substring matching',()=>{
  assert.equal(matchesSearch('vps',['VPS 香港']),true);
  assert.equal(matchesSearch('vpx',['VPS 香港']),false);
  assert.equal(matchesSearch('东京',['东京 VPS']),true);
  assert.equal(matchesSearch('东京',['东经 VPS']),false);
  const long='a'.repeat(25);assert.equal(matchesSearch(long,['a'.repeat(24)+'b']),false);
  assert.equal(matchesSearch('cn2',['cn3']),false);
});

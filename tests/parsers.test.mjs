// Page Musique en mode navigateur : analyse des liens YouTube et Deezer collés par l'utilisateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTube, parseDeezer } from '../app/js/music.js';

test('YouTube : liens de vidéo et de playlist reconnus', () => {
  const embed = (s) => parseYouTube(s)?.embed;
  assert.match(embed('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(embed('https://youtu.be/dQw4w9WgXcQ?list=PLabcdefghijklmnop'), /embed\/dQw4w9WgXcQ.*list=PLabcdefghijklmnop/);
  assert.match(embed('https://www.youtube.com/playlist?list=PLabcdefghijklmnop'), /videoseries\?list=PLabcdefghijklmnop/);
  assert.match(embed('dQw4w9WgXcQ'), /embed\/dQw4w9WgXcQ/);
  assert.match(embed('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), /embed\/dQw4w9WgXcQ/);
});

test('YouTube : tout autre site ou texte est refusé (jamais une iframe vers un site inconnu)', () => {
  assert.equal(parseYouTube('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTube('n’importe quoi'), null);
  assert.equal(parseYouTube(''), null);
});

test('Deezer : playlist, album, titre ; liens courts refusés', () => {
  assert.match(parseDeezer('https://www.deezer.com/fr/playlist/1313621735').embed, /widget\.deezer\.com\/widget\/dark\/playlist\/1313621735/);
  assert.match(parseDeezer('https://www.deezer.com/album/302127').embed, /album\/302127/);
  assert.match(parseDeezer('deezer.com/us/track/3135556').embed, /track\/3135556/);
  assert.equal(parseDeezer('https://link.deezer.com/s/abc'), null);
});

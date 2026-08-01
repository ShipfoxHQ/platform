import {LogTransformer, type TransformEvent} from '#core/transform.js';

const REPLACEMENT = '�';

// An 18-byte (multiple-of-3) secret so its standalone base64 has no padding and the phase-0
// wire form equals the full encoding: keeps the encoded-form assertions exact.
const SECRET = 'sf_mrt_SECRET12345';

function outputText(events: TransformEvent[]): string {
  return events
    .filter((e) => e.type === 'output')
    .map((e) => (e.type === 'output' ? e.data : ''))
    .join('');
}

describe('LogTransformer decoding', () => {
  it('reassembles a multi-byte char split across two pushes on the same pipe', () => {
    const transformer = new LogTransformer([]);
    const euro = Buffer.from('€', 'utf8'); // 0xE2 0x82 0xAC

    const first = transformer.push(euro.subarray(0, 2), 'stdout');
    const second = transformer.push(euro.subarray(2), 'stdout');

    expect(first).toEqual([]); // the decoder holds the partial sequence
    expect(outputText(second)).toBe('€');
  });

  it('reassembles a 4-byte code point split across two pushes on the same pipe', () => {
    const transformer = new LogTransformer([]);
    const grin = Buffer.from('😀', 'utf8'); // F0 9F 98 80

    const first = transformer.push(grin.subarray(0, 2), 'stdout');
    const second = transformer.push(grin.subarray(2), 'stdout');

    expect(first).toEqual([]);
    expect(outputText(second)).toBe('😀');
  });

  it('does not complete a stdout partial sequence with stderr bytes', () => {
    const transformer = new LogTransformer([]);
    const euro = Buffer.from('€', 'utf8');

    transformer.push(euro.subarray(0, 2), 'stdout');
    const stderr = transformer.push(euro.subarray(2), 'stderr');

    // The trailing byte arrives on stderr, whose decoder never saw the lead bytes.
    expect(outputText(stderr)).toBe(REPLACEMENT);
  });

  it('flushes a held incomplete sequence as the replacement character', () => {
    const transformer = new LogTransformer([]);
    const euro = Buffer.from('€', 'utf8');

    transformer.push(euro.subarray(0, 2), 'stdout');
    const flushed = transformer.flush();

    expect(outputText(flushed)).toBe(REPLACEMENT);
  });

  it('replaces invalid UTF-8 with the replacement character', () => {
    const transformer = new LogTransformer([]);

    const events = transformer.push(Buffer.from([0xff, 0xfe]), 'stdout');

    expect(outputText(events)).toBe(`${REPLACEMENT}${REPLACEMENT}`);
  });
});

describe('LogTransformer secret masking', () => {
  it('masks a secret split across two pushes within a line', () => {
    const transformer = new LogTransformer([SECRET]);

    transformer.push(Buffer.from('token=sf_mrt_SE'), 'stdout');
    const events = transformer.push(Buffer.from('CRET12345\n'), 'stdout');

    expect(outputText(events)).toBe('token=***\n');
  });

  it('masks a secret wrapped in ANSI and preserves the escape sequences', () => {
    const transformer = new LogTransformer([SECRET]);

    const events = transformer.push(Buffer.from(`[32m${SECRET}[0m\n`), 'stdout');

    expect(outputText(events)).toBe('[32m***[0m\n');
  });

  it.each([
    ['base64', Buffer.from(SECRET).toString('base64')],
    ['base64url', Buffer.from(SECRET).toString('base64url')],
    ['hex', Buffer.from(SECRET).toString('hex')],
  ])('masks the %s form of a secret', (_label, form) => {
    const transformer = new LogTransformer([SECRET]);

    const events = transformer.push(Buffer.from(`value=${form}\n`), 'stdout');

    expect(outputText(events)).toBe('value=***\n');
  });

  it('masks the URL-encoded form of a secret with reserved characters', () => {
    // '/', '+' and '=' all percent-encode, so the URL form genuinely differs from the literal
    // (a base64url-shaped token's URL form equals the literal and would test nothing).
    const secret = 'sf/rt+secret=99';
    const encoded = encodeURIComponent(secret);
    const transformer = new LogTransformer([secret]);

    const events = transformer.push(Buffer.from(`q=${encoded}\n`), 'stdout');

    expect(encoded).not.toBe(secret);
    expect(outputText(events)).toBe('q=***\n');
  });

  it('masks a secret embedded inside a larger base64 blob', () => {
    const transformer = new LogTransformer([SECRET]);
    const blob = Buffer.concat([
      Buffer.from('PREFIXAB'),
      Buffer.from(SECRET),
      Buffer.from('SUFFIXCD'),
    ]).toString('base64');

    const masked = outputText(transformer.push(Buffer.from(`body=${blob}\n`), 'stdout'));

    expect(masked).toContain('***');
    expect(masked).not.toContain(Buffer.from(SECRET).toString('base64').slice(0, 16));
  });

  it('masks a secret straddling a forced no-newline flush boundary', () => {
    const transformer = new LogTransformer([SECRET]);
    // A long unterminated line whose tail is the start of the secret. The lookbehind must hold
    // the partial secret back, then mask it once the rest arrives: no plaintext on the way out.
    const head = 'x'.repeat(40_000);

    const first = transformer.push(Buffer.from(`${head}sf_mrt_SE`), 'stdout');
    const second = transformer.push(Buffer.from('CRET12345 done\n'), 'stdout');
    const combined = outputText(first) + outputText(second);

    expect(combined).toBe(`${head}*** done\n`);
    expect(combined).not.toContain('sf_mrt_SE');
  });

  it('masks a secret straddling the release of an over-long marker candidate', () => {
    const transformer = new LogTransformer([SECRET]);
    // A `::group::`-leading run with no newline that grows past MARKER_CANDIDATE_LIMIT (16KB):
    // it stops being held as a marker and is released as output, and the lookbehind must still
    // hold the secret that straddles that release boundary.
    const head = `::group::${'x'.repeat(20_000)}`;

    const first = transformer.push(Buffer.from(`${head}sf_mrt_SE`), 'stdout');
    const second = transformer.push(Buffer.from('CRET12345 done\n'), 'stdout');
    const combined = outputText(first) + outputText(second);

    expect(combined).toBe(`${head}*** done\n`);
    expect(combined).not.toContain('sf_mrt_SE');
  });

  it('passes output through unchanged when no secrets are registered', () => {
    const transformer = new LogTransformer([]);

    const events = transformer.push(Buffer.from('token=sf_mrt_SECRET123456\n'), 'stdout');

    expect(outputText(events)).toBe('token=sf_mrt_SECRET123456\n');
  });

  it('masks secrets registered after construction', () => {
    const transformer = new LogTransformer([]);

    transformer.addSecrets([SECRET]);
    const events = transformer.push(Buffer.from(`token=${SECRET}\n`), 'stdout');

    expect(outputText(events)).toBe('token=***\n');
  });
});

describe('LogTransformer live streaming', () => {
  it('streams a no-newline line without waiting for a newline (no secrets)', () => {
    const transformer = new LogTransformer([]);

    const events = transformer.push(Buffer.from('Progress: 50%'), 'stdout');

    expect(outputText(events)).toBe('Progress: 50%');
  });

  it('streams the safe prefix of a no-newline line even with secrets registered', () => {
    const transformer = new LogTransformer([SECRET]);

    const events = transformer.push(Buffer.from('a'.repeat(200)), 'stdout');

    // All but a small lookbehind tail is emitted live, rather than held until the line ends.
    expect(outputText(events).length).toBeGreaterThan(150);
    expect(outputText(events)).toBe('a'.repeat(outputText(events).length));
  });

  it('keeps stdout and stderr complete lines in push order', () => {
    const transformer = new LogTransformer([]);

    const out1 = transformer.push(Buffer.from('out1\n'), 'stdout');
    const err1 = transformer.push(Buffer.from('err1\n'), 'stderr');
    const out2 = transformer.push(Buffer.from('out2\n'), 'stdout');

    expect(out1).toEqual([{type: 'output', src: 'stdout', data: 'out1\n'}]);
    expect(err1).toEqual([{type: 'output', src: 'stderr', data: 'err1\n'}]);
    expect(out2).toEqual([{type: 'output', src: 'stdout', data: 'out2\n'}]);
  });
});

describe('LogTransformer markers', () => {
  it('swallows group markers and keeps the lines between them as output', () => {
    const transformer = new LogTransformer([]);

    const events = transformer.push(
      Buffer.from('::group::Install\nbuilding\n::endgroup::\n'),
      'stdout',
    );

    expect(events).toEqual([
      {type: 'group_start', name: 'Install'},
      {type: 'output', src: 'stdout', data: 'building\n'},
      {type: 'group_end'},
    ]);
  });

  it('masks a secret inside a group name', () => {
    const transformer = new LogTransformer([SECRET]);

    const events = transformer.push(Buffer.from(`::group::run ${SECRET}\n`), 'stdout');

    expect(events).toEqual([{type: 'group_start', name: 'run ***'}]);
  });

  it('holds a marker that spans two pushes until its newline, then swallows it', () => {
    const transformer = new LogTransformer([]);

    const first = transformer.push(Buffer.from('::gro'), 'stdout');
    const second = transformer.push(Buffer.from('up::Build\n'), 'stdout');

    expect(first).toEqual([]); // held: still a viable marker prefix
    expect(second).toEqual([{type: 'group_start', name: 'Build'}]);
  });

  it('emits a trailing marker with no newline at flush', () => {
    const transformer = new LogTransformer([]);

    transformer.push(Buffer.from('::endgroup::'), 'stdout');
    const flushed = transformer.flush();

    expect(flushed).toEqual([{type: 'group_end'}]);
  });

  it('swallows a CRLF endgroup whose CR and LF arrive in separate pushes', () => {
    const transformer = new LogTransformer([]);

    const first = transformer.push(Buffer.from('::endgroup::\r'), 'stdout');
    const second = transformer.push(Buffer.from('\n'), 'stdout');

    expect(first).toEqual([]); // held across the CR, not released as output
    expect(second).toEqual([{type: 'group_end'}]);
  });

  it('swallows CRLF group markers and keeps a CRLF body line as output', () => {
    const transformer = new LogTransformer([]);

    const events = transformer.push(
      Buffer.from('::group::Install\r\nbuilding\r\n::endgroup::\r\n'),
      'stdout',
    );

    expect(events).toEqual([
      {type: 'group_start', name: 'Install'},
      {type: 'output', src: 'stdout', data: 'building\r\n'},
      {type: 'group_end'},
    ]);
  });
});

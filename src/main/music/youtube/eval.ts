import vm from 'node:vm';

const EVAL_TIMEOUT_MS = 5000;

/**
 * YouTube.js necesita ejecutar fragmentos del reproductor de YouTube para descifrar las URLs de audio
 * (ver https://ytjs.dev/guide/getting-started.html, "JavaScript Evaluator"). Es código remoto.
 *
 * Aislamiento aplicado:
 *  - contexto de V8 nuevo y vacío: sin `require`, `process`, `fetch`, `import()` ni sistema de archivos;
 *  - tiempo máximo de ejecución (evita bucles infinitos);
 *  - solo se devuelven datos serializables (JSON), nunca objetos del contexto remoto.
 *
 * Límite conocido: `node:vm` no es una frontera de seguridad fuerte frente a un atacante que
 * explote V8. Para este uso (fragmentos de nsig/firma acotados por YouTube.js) es proporcionado;
 * si el riesgo cambia, mover esta función a un proceso sin privilegios.
 */
export function evaluatePlayerScript(data: { output: string }): Record<string, unknown> {
  const out = vm.runInNewContext(`(function(){${data.output}\n})()`, Object.create(null), {
    timeout: EVAL_TIMEOUT_MS,
    displayErrors: false,
  });
  return JSON.parse(JSON.stringify(out ?? null)) as Record<string, unknown>;
}

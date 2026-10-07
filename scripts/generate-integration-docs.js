import { readFile, writeFile } from 'node:fs/promises';
const catalog = JSON.parse(
  await readFile(new URL('../public/admin/api-reference.json', import.meta.url), 'utf8'),
);
const template = await readFile(
  new URL('../docs/INTEGRATION_TEMPLATE.md', import.meta.url),
  'utf8',
);
const auth = {
  postKey: 'Header X-Api-Key: SUA_API_KEY.',
  getKey: 'Query string ?apikey=SUA_API_KEY.',
  public: 'X-Api-Key ou Authorization: Bearer; alternativamente Origin aprovado no browser.',
  admin: 'X-Admin-Api-Key no backend; ou cookie do painel, com CSRF e Origin em alterações.',
  login: 'API key administrativa no body e Origin igual a PUBLIC_URL.',
  origin: 'Origin aprovado.',
  none: 'Sem autenticação.',
};
const block = (label, value) =>
  '\n**' +
  label +
  '**\n\n' +
  (typeof value === 'string'
    ? value + '\n'
    : '```json\n' + JSON.stringify(value, null, 2) + '\n```\n');
const routes = catalog.routes
  .map((r) => {
    let text =
      '\n### ' +
      r.method +
      ' ' +
      r.path +
      '\n\n' +
      r.description +
      '\n\nAutenticação: ' +
      auth[r.auth] +
      '\n';
    if (r.params) text += block('Parâmetros do caminho', r.params);
    if (r.query) text += block('Query string GET', r.query);
    if (r.headers) text += block('Cabeçalhos adicionais', r.headers);
    text += block('Body', r.body || 'Não enviar body.');
    if (r.notes) text += '\n' + r.notes + '\n';
    return text + block('Resposta HTTP ' + (r.successStatus || 200), r.response);
  })
  .join('');
await writeFile(
  new URL('../docs/INTEGRATION_IA.md', import.meta.url),
  template.trimEnd() + '\n' + routes,
);
console.log(`Guia para IA gerado com ${catalog.routes.length} rotas.`);

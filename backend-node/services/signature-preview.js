// Shared signature draft rendering — one code path for both the HTTP
// /preview endpoint and the socket.io `signature:preview` live handler, so
// what the editor preview shows is byte-identical to a real send at send
// time (renderSignatureHtml/Text + sanitizeHtml, 'preview' context).
const {
  renderSignatureHtml,
  renderSignatureText,
  signatureHtmlBlock,
  signatureTextBlock,
} = require('./signature-resolver');
const { sanitizeHtml } = require('./template-renderer');

function renderSignatureDraft({ html, text, variables } = {}) {
  const vars = variables && typeof variables === 'object' ? variables : {};
  const renderedHtml = sanitizeHtml(renderSignatureHtml(String(html ?? '').slice(0, 20000), vars, 'preview').html || '');
  const renderedText = renderSignatureText(String(text ?? '').slice(0, 20000), vars, 'preview');
  return {
    name: '(draft)',
    resolvedFrom: 'draft',
    html: renderedHtml,
    text: renderedText,
    signatureBlock: signatureHtmlBlock(renderedHtml),
    signatureTextBlock: signatureTextBlock(renderedText),
  };
}

module.exports = { renderSignatureDraft };

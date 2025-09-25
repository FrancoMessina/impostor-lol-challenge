async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      //console.log('Text copied to clipboard successfully!');
    } catch (err) {
      //console.error('Failed to copy text: ', err);
      // Fallback for older browsers or insecure contexts (see below)
      fallbackCopyToClipboard(text); 
    }
  }

// EL FALLBACK ES POR SI NO ES HTTPS
function fallbackCopyToClipboard(text) {
const textarea = document.createElement('textarea');
textarea.value = text;
textarea.style.position = 'fixed'; // Prevent scrolling to bottom
textarea.style.opacity = '0'; // Hide the textarea
document.body.appendChild(textarea);
textarea.select();
try {
    document.execCommand('copy');
} catch (err) {
} finally {
    document.body.removeChild(textarea);
}
}

// COPIAR CODIGO DE SALA
document.getElementById("codigo-sala").addEventListener('click', function(e){
    salaCode = document.getElementById("codigo-sala-text").textContent
    copyToClipboard(salaCode);
    showAlert('success', 'Codigo de sala copiado');
})

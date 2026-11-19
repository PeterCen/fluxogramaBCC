import { CONFIG } from "./config.js"

const fbForm = $("feedbackForm");
if (fbForm) {
    fbForm.onsubmit = async e => {
        e.preventDefault();
        const sendBtn = $("fbSend");
        const statusEl = $("fbStatus");
        const typeVal = $("fbType") ? $("fbType").value : "Geral";
        const msgVal = $("fbMsg") ? $("fbMsg").value.trim() : "";
        const contactVal = $("fbContact") ? $("fbContact").value.trim() : "";

        const showStatus = (msg, cls) => {
            statusEl.className = `fb-status ${cls}`;
            statusEl.textContent = msg;
        };

        if (!msgVal) {
            alert("Por favor, digite sua mensagem antes de enviar.");
            return;
        }

        const endpoint = CONFIG?.FEEDBACK_URL;
        if (!endpoint || endpoint.includes("SEU_ID")) {
            showStatus("⚠️ Endpoint do formulário não configurado em config.js", "warn");
            return;
        }

        sendBtn.disabled = true;
        sendBtn.textContent = "Enviando...";
        statusEl.className = "fb-status";
        statusEl.textContent = "";

        try {
            const resp = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    assunto: typeVal,
                    mensagem: msgVal,
                    contato: contactVal || "Não informado",
                    email: contactVal.includes("@") ? contactVal : undefined,
                    _subject: `[Fluxograma BCC] ${typeVal}`
                })
            });

            if (resp.ok) {
                showStatus("✅ Obrigado! Seu feedback foi enviado com sucesso.", "ok");
                fbForm.reset();
            } else {
                const data = await resp.json().catch(() => ({}));
                const errText = data?.errors?.[0]?.message || "Ocorreu um erro ao enviar. Tente novamente mais tarde.";
                showStatus(`❌ ${errText}`, "err");
            }
        } catch (err) {
            showStatus("❌ Falha na conexão ao enviar. Verifique sua internet.", "err");
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = "📨 Enviar Mensagem";
        }
    };
}
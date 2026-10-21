(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let lastQr = "";
  let isSending = false;

  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
  }

  function addLog(msg, level = "INFO") {
    const logs = $("blastLogs");
    const row = document.createElement("div");
    row.className = "term-line";
    const time = new Date().toLocaleTimeString('id-ID');
    row.innerHTML = `<time>${time}</time><span class="badge-${level.toLowerCase()}">[${level}]</span> <span>${msg}</span>`;
    logs.appendChild(row);
    logs.scrollTop = logs.scrollHeight;
  }

  // Fungsi Spintax Parser (Variasi Kata Acak)
  function parseSpintax(text) {
    return text.replace(/\{([^{}]+)\}/g, (match, choices) => {
      const options = choices.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
  }

  async function checkStatus() {
    try {
      const res = await fetch("/status");
      const data = await res.json();
      const badge = $("statusBadge");
      const qrBox = $("qrcode");

      if (data.status === "connected") {
        badge.className = "status-pill status-good";
        badge.innerHTML = '<span class="pulse-dot"></span> Terhubung (Ready)';
        qrBox.innerHTML = '<div class="qr-placeholder" style="color:var(--green)"><span>✅</span><br><small>WA TERHUBUNG</small></div>';
        lastQr = "";
      } else if (data.status === "qr_ready" && data.qr) {
        badge.className = "status-pill status-wait";
        badge.innerHTML = '<span class="pulse-dot"></span> Menunggu Scan';

        if (lastQr !== data.qr) {
          lastQr = data.qr;
          qrBox.innerHTML = "";
          new QRCode(qrBox, { text: data.qr, width: 155, height: 155 });
        }
      } else {
        badge.className = "status-pill status-wait";
        badge.innerHTML = '<span class="pulse-dot"></span> Terputus';
      }
    } catch (e) {
      $("statusBadge").className = "status-pill status-bad";
      $("statusBadge").innerHTML = "❌ Offline";
    }
  }

  async function requestPairing() {
    const phone = $("pairPhone").value.trim();
    if (!phone) return showToast("Masukkan nomor HP!");

    try {
      const res = await fetch("/request-pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone })
      });
      const data = await res.json();

      if (data.success) {
        $("pairingCodeDisplay").classList.remove("hidden");
        $("pairingCodeText").textContent = data.pairingCode;
        addLog("Kode pairing berhasil didapatkan!", "SUCCESS");
      } else {
        showToast(data.error || "Gagal mengambil kode.");
      }
    } catch (e) {
      showToast("Gagal terhubung ke backend.");
    }
  }

  async function refreshSession() {
    addLog("Mereset sesi & meminta QR baru...", "INFO");
    try {
      const res = await fetch("/refresh-session", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("Sesi di-reset. Memuat QR baru...");
        $("qrcode").innerHTML = '<div class="qr-placeholder"><span>▦</span><small>MEMUAT...</small></div>';
        lastQr = "";
        setTimeout(checkStatus, 2000);
      }
    } catch (e) {
      showToast("Gagal reset sesi.");
    }
  }

  // Upload CSV/TXT Listener
  $("csvFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
      const lines = event.target.result.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const current = $("targetNumbers").value.trim();
      $("targetNumbers").value = current ? current + "\n" + lines.join("\n") : lines.join("\n");
      
      updateCount();
      showToast(`Sukses memuat ${lines.length} kontak dari CSV!`);
      addLog(`File ${file.name} berhasil dimuat.`, "SUCCESS");
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  function updateCount() {
    const lines = $("targetNumbers").value.split("\n").filter(l => l.trim()).length;
    $("targetCountMeta").textContent = `${lines} Kontak`;
  }

  async function startBlast() {
    if (isSending) return;
    const rawTarget = $("targetNumbers").value.trim();
    const templateMsg = $("messageContent").value.trim();
    const delaySec = parseInt($("delaySelect").value) || 5;

    if (!rawTarget) return showToast("Daftar kontak masih kosong!");
    if (!templateMsg) return showToast("Isi pesan belum ditulis!");

    const lines = rawTarget.split("\n").map(l => l.trim()).filter(Boolean);
    isSending = true;
    $("startButton").disabled = true;
    $("startButton").innerText = "⏳ Memproses Blast...";
    $("progressWrap").classList.remove("hidden");

    addLog(`Memulai TEAM TARSIUS BLAST ke ${lines.length} target...`, "INFO");

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(",");
      const num = parts[0].trim();
      const name = parts[1] ? parts[1].trim() : "Kak";

      // 1. Ganti Variabel {nama}
      let personalizedMsg = templateMsg.replace(/\{nama\}/g, name);
      // 2. Parse Spintax Variasi Kata
      personalizedMsg = parseSpintax(personalizedMsg);

      addLog(`[${i + 1}/${lines.length}] Kirim ke ${num} (${name})...`, "INFO");

      try {
        const res = await fetch("/send-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number: num, message: personalizedMsg })
        });
        const result = await res.json();

        if (result.success) {
          addLog(`Tersebar ke ${num}`, "SUCCESS");
        } else {
          addLog(`Gagal ke ${num}: ${result.error}`, "ERROR");
        }
      } catch (e) {
        addLog(`Error koneksi ke ${num}`, "ERROR");
      }

      // Update Progress Bar
      const percent = Math.round(((i + 1) / lines.length) * 100);
      $("progressBar").style.width = `${percent}%`;
      $("progressPercent").textContent = `${percent}%`;
      $("progressText").textContent = `Progres: ${i + 1}/${lines.length}`;

      if (i < lines.length - 1) {
        await new Promise(r => setTimeout(r, delaySec * 1000));
      }
    }

    addLog("🎉 TEAM TARSIUS BLAST Massal Selesai!", "SUCCESS");
    showToast("Blast Massal Selesai!");
    isSending = false;
    $("startButton").disabled = false;
    $("startButton").innerText = "🚀 Mulai Blast Massal";
  }

  // Event Listeners
  $("pairButton").addEventListener("click", requestPairing);
  $("refreshSessionBtn").addEventListener("click", refreshSession);
  $("startButton").addEventListener("click", startBlast);
  $("clearButton").addEventListener("click", () => {
    $("targetNumbers").value = "";
    $("messageContent").value = "";
    updateCount();
    $("progressWrap").classList.add("hidden");
  });
  $("clearLogs").addEventListener("click", () => $("blastLogs").innerHTML = "");
  $("targetNumbers").addEventListener("input", updateCount);

  setInterval(checkStatus, 3000);
  checkStatus();
})();

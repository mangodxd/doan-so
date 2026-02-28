const socket = io();

// Auto-map toàn bộ DOM Elements có ID vào object `$` (Chuyển kebab-case -> camelCase)
const $ = {};
document.querySelectorAll('[id]').forEach(el => {
    const camelId = el.id.replace(/-([a-z])/g, g => g[1].toUpperCase());
    $[camelId] = el;
});

const STORED_NAME_KEY = 'guessNumber_playerName';
let myId = null, currentRoomId = null, myName = "", roomDigits = 5, mySecretValue = "";

// Utils
const showToast = (msg, type = 'error') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    $.toastContainer.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
};

const showView = (name) => {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.dataset.name !== name));
};

const sendChat = () => {
    const msg = $.chatInput.value.trim();
    if (msg) { socket.emit('sendMessage', { roomId: currentRoomId, message: msg }); $.chatInput.value = ''; }
};

window.addEventListener('load', () => {
    if (localStorage.getItem(STORED_NAME_KEY)) $.username.value = localStorage.getItem(STORED_NAME_KEY);
    
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('room');
    if (roomIdFromUrl) {
        myName = localStorage.getItem(STORED_NAME_KEY) || prompt("Nhập tên:")?.trim() || "Player_" + Math.floor(Math.random() * 1000);
        if (!myName) return;
        localStorage.setItem(STORED_NAME_KEY, myName);
        socket.emit('joinRoom', { roomId: roomIdFromUrl, username: myName });
    }
});

// EVENT DELEGATION: Chỉ cần 1 Listener cho toàn bộ nút bấm
document.addEventListener('click', e => {
    const id = e.target.id;
    const isAnswerBtn = e.target.classList.contains('answer-btn');

    if (id === 'create-btn') {
        myName = $.username.value.trim() || "Player1";
        localStorage.setItem(STORED_NAME_KEY, myName);
        socket.emit('createRoom', { username: myName, digits: parseInt($.digitSelect.value) });
    }
    
    if (id === 'join-btn') {
        myName = $.username.value.trim() || "Player2";
        localStorage.setItem(STORED_NAME_KEY, myName);
        if ($.roomInput.value.trim()) socket.emit('joinRoom', { roomId: $.roomInput.value.trim(), username: myName });
    }
    
    if (id === 'confirm-secret-btn') {
        const secret = $.secretInput.value.trim();
        if (secret.length !== roomDigits) return showToast(`Cần chính xác ${roomDigits} chữ số.`, 'error');
        mySecretValue = secret;
        socket.emit('submitSecret', { roomId: currentRoomId, secret });
        $.secretForm.classList.add('hidden');
        $.setupStatus.innerText = "Đang chờ đối thủ xác nhận...";
    }
    
    if (id === 'ask-btn') {
        const q = $.questionInput.value.trim();
        if (q) { socket.emit('askQuestion', { roomId: currentRoomId, question: q }); $.questionInput.value = ''; }
    }
    
    if (isAnswerBtn) socket.emit('answerQuestion', { roomId: currentRoomId, answer: e.target.dataset.val });
    
    if (id === 'guess-btn') $.guessModal.showModal(); // HTML5 Dialog API
    if (id === 'cancel-guess-btn') $.guessModal.close();
    
    if (id === 'rules-btn') $.rulesModal.showModal();
    if (id === 'close-rules-btn') $.rulesModal.close();
    
    if (id === 'submit-guess-btn') {
        const guess = $.finalGuessInput.value.trim();
        if (guess.length !== roomDigits) return showToast(`Phải đủ ${roomDigits} chữ số!`, 'error');
        socket.emit('makeGuess', { roomId: currentRoomId, guess });
        $.guessModal.close();
        $.finalGuessInput.value = '';
    }
    
    if (id === 'surrender-btn' && confirm("Đầu hàng ngay lập tức?")) socket.emit('surrender', currentRoomId);
    if (id === 'chat-send-btn') sendChat();
    if (id === 'home-btn') window.location.href = window.location.pathname;
});

$.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

// Tự kích hoạt hàm global cho việc copy link từ innerHTML
window.copyRoomLink = () => {
    document.getElementById("copy-link").select();
    document.execCommand("copy");
    showToast("Đã copy link phòng!", "info");
};

// --- SOCKET EVENTS ---
socket.on('connect', () => { myId = socket.id; });
socket.on('error', (msg) => showToast(msg, 'error'));

socket.on('roomJoined', ({ roomId, isHost }) => {
    currentRoomId = roomId;
    showView('setup');
    $.setupRoomId.innerText = roomId;
    window.history.pushState({roomId}, '', "?room=" + roomId);
    
    if (isHost) {
        $.setupStatus.innerHTML = `Đã tạo phòng! Link chia sẻ:<br>
            <input type="text" value="${window.location.origin}${window.location.pathname}?room=${roomId}" readonly id="copy-link" style="width:80%; font-size:12px; margin-top:10px;">
            <button onclick="copyRoomLink()" style="width:auto; padding:5px 10px;">Copy Link</button>`;
    } else {
        $.setupStatus.innerText = "Đang chờ chủ phòng bắt đầu...";
    }
});

socket.on('updateRoomState', (room) => {
    roomDigits = room.digits;
    $.digitHint.innerText = $.guessDigitHint.innerText = `Yêu cầu: Nhập ${roomDigits} số`;
    $.secretInput.placeholder = `Ví dụ: ${"1".repeat(roomDigits)}`;
    $.secretInput.maxLength = $.finalGuessInput.maxLength = roomDigits;

    if (['setup', 'waiting'].includes(room.state)) {
        showView('setup');
        const me = room.players.find(p => p.id === myId);
        if (room.players.length === 2) {
            $.setupStatus.innerText = me?.ready ? "Đang chờ đối thủ xác nhận..." : "Đối thủ đã vào! Nhập số bí mật của bạn.";
            $.secretForm.classList.toggle('hidden', !!me?.ready);
        }
    } else if (room.state === 'playing') {
        showView('game');
        $.gameRoomId.innerText = room.id;
        $.gameDigits.innerText = room.digits;
        $.mySecretNumber.innerText = mySecretValue;
        $.opponentName.innerText = room.players.find(p => p.id !== myId)?.name || "Đối thủ";
        
        // Render History
        $.timeline.innerHTML = room.history.map(item => `<p><span class="${item.type}">${item.type === 'system' ? '' : item.author + ': '}</span>${item.text}</p>`).join('');
        $.timeline.scrollTop = $.timeline.scrollHeight;

        // UI Action States
        $.askingUi.classList.toggle('hidden', !(room.turn === myId && room.actionState === 'asking'));
        $.answeringUi.classList.toggle('hidden', !(room.turn !== myId && room.actionState === 'answering'));
        $.waitingUi.classList.toggle('hidden', !((room.turn === myId && room.actionState !== 'asking') || (room.turn !== myId && room.actionState !== 'answering')));
        $.guessBtn.disabled = room.turn !== myId || room.actionState !== 'asking';
        
        if (!$.waitingUi.classList.contains('hidden')) {
            $.waitingUi.innerHTML = room.turn === myId ? "<p>Đang chờ trả lời...</p>" : "<p>Đang chờ đối thủ hỏi...</p>";
        }
    }
});

socket.on('playerLeft', (msg) => {
    showToast(msg, 'info');
    $.secretForm.classList.add('hidden');
    $.setupStatus.innerHTML = msg;
    mySecretValue = $.secretInput.value = "";
});

socket.on('guessResult', ({ success }) => { if (!success) showToast("Đoán sai rồi! Bạn mất lượt.", "error"); });

socket.on('gameOver', ({ room }) => {
    $.winnerText.innerText = room.winner === myId ? "Bạn Đã Thắng! 🎉" : "Bạn Đã Thua. 💀";
    $.revealArea.innerHTML = `<h3>Số Bí Mật</h3>` + room.players.map(p => `<p><strong>${p.name}:</strong> ${p.secretRaw || 'Chưa thiết lập'}</p>`).join('');
    $.gameOverModal.showModal();
});

socket.on('receiveMessage', ({ author, text }) => {
    $.chatFeed.innerHTML += `<p><strong>${author}:</strong> ${text}</p>`;
    $.chatFeed.scrollTop = $.chatFeed.scrollHeight;
});
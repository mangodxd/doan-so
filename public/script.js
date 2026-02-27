const socket = io();

// --- XỬ LÝ LINK PHÒNG ---
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('room');

    if (roomIdFromUrl) {
        let name = prompt("Nhập tên của bạn (để trống sẽ lấy tên ngẫu nhiên):");
        if (name === null) return; // Nếu nhấn Cancel thì thôi
        
        if (name.trim() === "") {
            name = "Player_" + Math.floor(Math.random() * 1000);
        }
        
        myName = name;
        socket.emit('joinRoom', { roomId: roomIdFromUrl, username: myName });
    }
});
// ------------------------------------------

// DOM Elements
const views = {
    lobby: document.getElementById('lobby-view'),
    setup: document.getElementById('setup-view'),
    game: document.getElementById('game-view')
};

// State
let myId = null;
let currentRoomId = null;
let myName = "";
let roomDigits = 5; // Lưu trữ số lượng chữ số của phòng hiện tại
let mySecretValue = ""; // Lưu số bí mật để hiển thị lại

// Lobby Actions
document.getElementById('create-btn').addEventListener('click', () => {
    myName = document.getElementById('username').value.trim() || "Player1";
    const digits = document.getElementById('digit-select').value;
    socket.emit('createRoom', { username: myName, digits: parseInt(digits) });
});

document.getElementById('join-btn').addEventListener('click', () => {
    myName = document.getElementById('username').value.trim() || "Player2";
    const roomId = document.getElementById('room-input').value.trim();
    if(roomId) socket.emit('joinRoom', { roomId, username: myName });
});

// Setup Actions
document.getElementById('confirm-secret-btn').addEventListener('click', () => {
    const secret = document.getElementById('secret-input').value.trim();
    
    // Kiểm tra độ dài chính xác bằng n chữ số
    if (secret === "" || secret.length !== roomDigits) {
        return alert(`Vui lòng nhập chính xác ${roomDigits} chữ số.`);
    }
    
    mySecretValue = secret; // <-- LƯU SỐ VÀO ĐÂY
    socket.emit('submitSecret', { roomId: currentRoomId, secret });
    document.getElementById('secret-form').classList.add('hidden');
    document.getElementById('setup-status').innerText = "Đang chờ đối thủ xác nhận...";
});

// Game Actions
document.getElementById('ask-btn').addEventListener('click', () => {
    const q = document.getElementById('question-input').value.trim();
    if(q) {
        socket.emit('askQuestion', { roomId: currentRoomId, question: q });
        document.getElementById('question-input').value = '';
    }
});

document.querySelectorAll('.answer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        socket.emit('answerQuestion', { roomId: currentRoomId, answer: e.target.dataset.val });
    });
});

// Controls & Modals
document.getElementById('guess-btn').addEventListener('click', () => {
    document.getElementById('guess-modal').classList.remove('hidden');
});
document.getElementById('cancel-guess-btn').addEventListener('click', () => {
    document.getElementById('guess-modal').classList.add('hidden');
});
document.getElementById('submit-guess-btn').addEventListener('click', () => {
    const guess = document.getElementById('final-guess-input').value.trim();
    
    if (guess.length !== roomDigits) {
        return alert(`Dự đoán phải có đúng ${roomDigits} chữ số!`);
    }

    socket.emit('makeGuess', { roomId: currentRoomId, guess });
    document.getElementById('guess-modal').classList.add('hidden');
});

document.getElementById('surrender-btn').addEventListener('click', () => {
    if(confirm("Bạn có chắc chắn muốn đầu hàng? Đối thủ của bạn sẽ thắng ngay lập tức.")) {
        socket.emit('surrender', currentRoomId);
    }
});

// Chat
document.getElementById('chat-send-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});
function sendChat() {
    const msg = document.getElementById('chat-input').value.trim();
    if(msg) {
        socket.emit('sendMessage', { roomId: currentRoomId, message: msg });
        document.getElementById('chat-input').value = '';
    }
}

document.getElementById('home-btn').addEventListener('click', () => {
    window.location.reload();
});

// Socket Listeners
socket.on('connect', () => { myId = socket.id; });

socket.on('error', (msg) => alert(msg));

socket.on('roomJoined', ({ roomId, isHost }) => {
    currentRoomId = roomId;
    switchView('setup');
    document.getElementById('setup-room-id').innerText = roomId;
    
    // Tạo link phòng
    const lanUrl = window.location.origin + "/?room=" + roomId;
    
    if (isHost) {
        document.getElementById('setup-status').innerHTML = `
            Đã tạo phòng! Gửi link này cho bạn bè:<br>
            <input type="text" value="${lanUrl}" readonly id="copy-link" 
                   style="width:80%; font-size:12px; margin-top:10px;">
            <button onclick="copyRoomLink()" style="width:auto; padding:5px 10px;">Copy Link</button>
        `;
    } else {
        document.getElementById('setup-status').innerText = "Đang chờ chủ phòng bắt đầu trò chơi...";
    }
});

socket.on('updateRoomState', (room) => {
    // Cập nhật số chữ số giới hạn từ server
    roomDigits = room.digits;
    
    // Cập nhật UI gợi ý cho người dùng
    document.getElementById('digit-hint').innerText = `Yêu cầu: Nhập đúng ${roomDigits} chữ số`;
    document.getElementById('secret-input').placeholder = `Ví dụ: ${"1".repeat(roomDigits)}`;
    document.getElementById('secret-input').maxLength = roomDigits;
    
    document.getElementById('guess-digit-hint').innerText = `Yêu cầu: Nhập đúng ${roomDigits} chữ số`;
    document.getElementById('final-guess-input').maxLength = roomDigits;

    if (room.state === 'setup') {
        const me = room.players.find(p => p.id === myId);
        if (room.players.length === 2) {
            if (me && me.ready) {
                document.getElementById('setup-status').innerText = "Đang chờ đối thủ xác nhận...";
                document.getElementById('secret-form').classList.add('hidden');
            } else {
                document.getElementById('setup-status').innerText = "Đối thủ đã tham gia! Hãy nhập số bí mật của bạn.";
                document.getElementById('secret-form').classList.remove('hidden');
            }
        }
    } else if (room.state === 'playing') {
        switchView('game');
        document.getElementById('game-room-id').innerText = room.id;
        document.getElementById('game-digits').innerText = room.digits; // Hiển thị số chữ số
        document.getElementById('my-secret-number').innerText = mySecretValue; // Hiển thị số của mình
        
        const opponent = room.players.find(p => p.id !== myId);
        document.getElementById('opponent-name').innerText = opponent ? opponent.name : "Đối thủ";
        
        renderHistory(room.history);
        updateActionUI(room);
    }
});

socket.on('guessResult', ({ success }) => {
    if (!success) alert("Đoán sai rồi! Bạn bị mất lượt.");
});

socket.on('gameOver', ({ room }) => {
    const amIWinner = room.winner === myId;
    document.getElementById('winner-text').innerText = amIWinner ? "Bạn Đã Thắng! 🎉" : "Bạn Đã Thua. 💀";
    
    // Tiết lộ số bí mật
    let revealHtml = `<h3>Số Bí Mật Được Tiết Lộ</h3>`;
    room.players.forEach(p => {
        revealHtml += `<p><strong>${p.name}:</strong> ${p.secretRaw || 'Chưa thiết lập'}</p>`;
    });
    document.getElementById('reveal-area').innerHTML = revealHtml;
    
    document.getElementById('game-over-modal').classList.remove('hidden');
});

socket.on('receiveMessage', ({ author, text }) => {
    const chatFeed = document.getElementById('chat-feed');
    chatFeed.innerHTML += `<p><strong>${author}:</strong> ${text}</p>`;
    chatFeed.scrollTop = chatFeed.scrollHeight;
});

// Helper UI Functions
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

function renderHistory(history) {
    const feed = document.getElementById('timeline');
    feed.innerHTML = history.map(item => {
        let spanClass = item.type; // system, question, answer, guess
        return `<p><span class="${spanClass}">${item.type === 'system' ? '' : item.author + ': '}</span>${item.text}</p>`;
    }).join('');
    feed.scrollTop = feed.scrollHeight;
}

function updateActionUI(room) {
    const askingUI = document.getElementById('asking-ui');
    const answeringUI = document.getElementById('answering-ui');
    const waitingUI = document.getElementById('waiting-ui');
    const guessBtn = document.getElementById('guess-btn');

    askingUI.classList.add('hidden');
    answeringUI.classList.add('hidden');
    waitingUI.classList.add('hidden');
    guessBtn.disabled = true;

    if (room.turn === myId) {
        if (room.actionState === 'asking') {
            askingUI.classList.remove('hidden');
            guessBtn.disabled = false;
        } else {
            waitingUI.classList.remove('hidden');
            waitingUI.innerHTML = "<p>Đang chờ đối thủ trả lời...</p>";
        }
    } else {
        if (room.actionState === 'answering') {
            answeringUI.classList.remove('hidden');
        } else {
            waitingUI.classList.remove('hidden');
            waitingUI.innerHTML = "<p>Đang chờ đối thủ hỏi...</p>";
        }
    }
}

function copyRoomLink() {
    const copyText = document.getElementById("copy-link");
    copyText.select();
    document.execCommand("copy");
    alert("Đã copy link phòng!");
}
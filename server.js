const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function hashSecret(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function sanitizeRoom(room) {
    const safeRoom = JSON.parse(JSON.stringify(room));
    safeRoom.players.forEach(p => delete p.secretRaw);
    return safeRoom;
}

function logMatch(room) {
    const logEntry = JSON.stringify(room) + '\n';
    fs.appendFile('database.json', logEntry, (err) => {
        if (err) console.error("Lỗi khi lưu log trận đấu:", err);
    });
}

// Hàm "lười" để gửi update state gọn hơn
const broadcastUpdate = (roomId) => {
    const room = rooms[roomId];
    if (room) io.to(roomId).emit('updateRoomState', sanitizeRoom(room));
};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createRoom', ({ username, digits }) => {
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        
        rooms[roomId] = {
            id: roomId,
            host: socket.id,
            players: [{ id: socket.id, name: username, ready: false }],
            digits: parseInt(digits) || 5,
            state: "waiting",
            turn: null,
            actionState: null,
            history: []
        };
        
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, isHost: true });
        broadcastUpdate(roomId);
    });

    socket.on('joinRoom', ({ roomId, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error', 'Không tìm thấy phòng.');
        if (room.players.length >= 2) return socket.emit('error', 'Phòng đã đầy.');
        if (room.state !== 'waiting') return socket.emit('error', 'Trò chơi đã bắt đầu.');

        room.players.push({ id: socket.id, name: username, ready: false });
        room.state = "setup";
        
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, isHost: false });
        broadcastUpdate(roomId);
    });

    socket.on('submitSecret', ({ roomId, secret }) => {
        const room = rooms[roomId];
        if (!room) return;

        if (!secret || secret.toString().length !== room.digits) {
            return socket.emit('error', 'Dữ liệu không hợp lệ!');
        }

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.secretHash = hashSecret(secret);
            player.secretRaw = secret;
            player.ready = true;
        }

        if (room.players.length === 2 && room.players.every(p => p.ready)) {
            room.state = "playing";
            room.turn = room.players[Math.floor(Math.random() * 2)].id;
            room.actionState = 'asking';
        }
        
        broadcastUpdate(roomId);
    });

    socket.on('askQuestion', ({ roomId, question }) => {
        const room = rooms[roomId];
        if (room && room.state === 'playing' && room.turn === socket.id && room.actionState === 'asking') {
            const player = room.players.find(p => p.id === socket.id);
            room.history.push({ type: 'question', text: question, author: player.name });
            room.actionState = 'answering';
            broadcastUpdate(roomId);
        }
    });

    socket.on('answerQuestion', ({ roomId, answer }) => {
        const room = rooms[roomId];
        if (room && room.state === 'playing' && room.turn !== socket.id && room.actionState === 'answering') {
            const player = room.players.find(p => p.id === socket.id);
            room.history.push({ type: 'answer', text: answer, author: player.name });
            room.turn = socket.id; 
            room.actionState = 'asking';
            broadcastUpdate(roomId);
        }
    });

    socket.on('makeGuess', ({ roomId, guess }) => {
        const room = rooms[roomId];
        if (!room || room.state !== 'playing' || room.turn !== socket.id || room.actionState !== 'asking') return;

        const player = room.players.find(p => p.id === socket.id);
        const opponent = room.players.find(p => p.id !== socket.id);
        
        room.history.push({ type: 'guess', text: `Đã đoán: ${guess}`, author: player.name });

        if (hashSecret(guess) === opponent.secretHash) {
            room.state = 'finished';
            room.winner = player.id;
            room.history.push({ type: 'system', text: `${player.name} đã đoán đúng và GIÀNH CHIẾN THẮNG!` });
            io.to(roomId).emit('gameOver', { room: room }); 
            logMatch(room);
        } else {
            room.history.push({ type: 'system', text: `Dự đoán của ${player.name} không chính xác.` });
            room.turn = opponent.id;
            room.actionState = 'asking';
            socket.emit('guessResult', { success: false });
            broadcastUpdate(roomId);
        }
    });

    socket.on('surrender', (roomId) => {
        const room = rooms[roomId];
        if (room && room.state === 'playing') {
            const opponent = room.players.find(p => p.id !== socket.id);
            room.state = 'finished';
            room.winner = opponent.id;
            room.history.push({ type: 'system', text: `${room.players.find(p=>p.id===socket.id).name} đã đầu hàng.` });
            io.to(roomId).emit('gameOver', { room: room }); 
            logMatch(room);
        }
    });

    socket.on('sendMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            io.to(roomId).emit('receiveMessage', { author: player ? player.name : "Khán giả", text: message });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                
                if (room.state === 'playing') {
                    room.state = 'finished';
                    const opponent = room.players.find(p => p.id !== socket.id);
                    room.winner = opponent ? opponent.id : null;
                    room.history.push({ type: 'system', text: `${player.name} đã ngắt kết nối. Trò chơi kết thúc.` });
                    io.to(roomId).emit('gameOver', { room: room });
                    logMatch(room);
                } 
                else if (room.state === 'setup' || room.state === 'waiting') {
                    room.players.splice(playerIndex, 1);
                    if (room.players.length === 0) {
                        delete rooms[roomId]; 
                    } else {
                        room.state = 'waiting';
                        room.players.forEach(p => { 
                            p.ready = false; 
                            delete p.secretHash; 
                            delete p.secretRaw; 
                        });
                        broadcastUpdate(roomId);
                        io.to(roomId).emit('playerLeft', 'Đối thủ đã thoát. Đang chờ người khác...');
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => console.log(`We are good to go on port ${PORT}`));
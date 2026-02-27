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

// In-memory store for active rooms
const rooms = {};

// Helper: Hash the secret
function hashSecret(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

// Helper: Sanitize room data to prevent exposing secrets to clients
function sanitizeRoom(room) {
    const safeRoom = JSON.parse(JSON.stringify(room));
    safeRoom.players.forEach(p => delete p.secretRaw);
    return safeRoom;
}

// Helper: Log finished games to lightweight JSON file (JSONL format)
function logMatch(room) {
    const logEntry = JSON.stringify(room) + '\n';
    fs.appendFile('database.json', logEntry, (err) => {
        if (err) console.error("Lỗi khi lưu log trận đấu:", err);
    });
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // CẬP NHẬT: Nhận thêm thông số digits
    socket.on('createRoom', ({ username, digits }) => {
        const roomId = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit ID
        const roomDigits = parseInt(digits) || 5; // Default 5 nếu có lỗi

        rooms[roomId] = {
            id: roomId,
            host: socket.id,
            players: [{ id: socket.id, name: username, ready: false }],
            digits: roomDigits, // Lưu số chữ số yêu cầu
            state: "waiting",
            turn: null,
            actionState: null,
            history: []
        };
        
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, isHost: true });
        io.to(roomId).emit('updateRoomState', sanitizeRoom(rooms[roomId]));
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
        io.to(roomId).emit('updateRoomState', sanitizeRoom(room));
    });

    socket.on('submitSecret', ({ roomId, secret }) => {
        const room = rooms[roomId];
        if (!room) return;

        // Xác thực phía server: phải đúng N chữ số
        if (!secret || secret.toString().length !== room.digits) {
            return socket.emit('error', 'Dữ liệu không hợp lệ!');
        }

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.secretHash = hashSecret(secret);
            player.secretRaw = secret;
            player.ready = true;
        }

        // Check if both players are ready
        if (room.players.length === 2 && room.players.every(p => p.ready)) {
            room.state = "playing";
            room.turn = room.players[Math.floor(Math.random() * 2)].id; // Random first turn
            room.actionState = 'asking';
        }
        
        io.to(roomId).emit('updateRoomState', sanitizeRoom(room));
    });

    socket.on('askQuestion', ({ roomId, question }) => {
        const room = rooms[roomId];
        if (room && room.state === 'playing' && room.turn === socket.id && room.actionState === 'asking') {
            const player = room.players.find(p => p.id === socket.id);
            room.history.push({ type: 'question', text: question, author: player.name });
            room.actionState = 'answering';
            io.to(roomId).emit('updateRoomState', sanitizeRoom(room));
        }
    });

    socket.on('answerQuestion', ({ roomId, answer }) => {
        const room = rooms[roomId];
        if (room && room.state === 'playing' && room.turn !== socket.id && room.actionState === 'answering') {
            const player = room.players.find(p => p.id === socket.id);
            room.history.push({ type: 'answer', text: answer, author: player.name });
            
            // Switch turns
            room.turn = socket.id; 
            room.actionState = 'asking';
            io.to(roomId).emit('updateRoomState', sanitizeRoom(room));
        }
    });

    socket.on('makeGuess', ({ roomId, guess }) => {
        const room = rooms[roomId];
        if (!room || room.state !== 'playing' || room.turn !== socket.id || room.actionState !== 'asking') return;

        const player = room.players.find(p => p.id === socket.id);
        const opponent = room.players.find(p => p.id !== socket.id);
        const guessHash = hashSecret(guess);

        room.history.push({ type: 'guess', text: `Đã đoán: ${guess}`, author: player.name });

        if (guessHash === opponent.secretHash) {
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
            io.to(roomId).emit('updateRoomState', sanitizeRoom(room));
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
            const name = player ? player.name : "Khán giả";
            io.to(roomId).emit('receiveMessage', { author: name, text: message });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const player = room.players.find(p => p.id === socket.id);
            if (player && room.state === 'playing') {
                room.state = 'finished';
                const opponent = room.players.find(p => p.id !== socket.id);
                room.winner = opponent ? opponent.id : null;
                room.history.push({ type: 'system', text: `${player.name} đã ngắt kết nối. Trò chơi kết thúc.` });
                io.to(roomId).emit('gameOver', { room: room });
                logMatch(room);
            }
        }
    });
});

const PORT = process.env.PORT || 8000;
const os = require('os');
server.listen(PORT, '0.0.0.0', () => {
    console.log("We are good to go!")
});
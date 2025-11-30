const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid'); // Cần thư viện uuid

// Khởi tạo WebSocket Server trên cổng đã được chỉ định (Dùng cổng động của Render)
const PORT = process.env.PORT || 8080; 
const wss = new WebSocket.Server({ port: PORT });

console.log(`Server đã sẵn sàng. Chờ kết nối trên cổng: ${PORT}`);
console.log('Server đã sẵn sàng. Chờ kết nối...');

// 1. Cấu trúc để quản lý các phòng
// Key: Room ID (UUID) | Value: Object { name: string, clients: WebSocket[], maxPlayers: number }
const rooms = new Map();

// 2. Map để lưu trữ kết nối thuộc phòng nào
// Key: WebSocket | Value: Room ID
const clientRoomMap = new Map();

// 3. Map để lưu trữ tên người dùng
// Key: WebSocket | Value: Username
const clientUserMap = new Map();

// 4. Map MỚI để ánh xạ Tên Phòng (Dễ nhớ) sang UUID thật
// Key: Tên Phòng (string) | Value: Room ID (UUID)
const roomNameMap = new Map();

// --- HÀM GỬI CẬP NHẬT SẢNH CHỜ (LOBBY) ---
function broadcastLobbyUpdate() {
    const roomsArray = Array.from(rooms.entries()).map(([id, room]) => ({
        id: id,
        name: room.name,
        currentPlayers: room.clients.length,
        maxPlayers: room.maxPlayers
    }));
    
    const message = JSON.stringify({
        type: 'LOBBY_UPDATE',
        rooms: roomsArray
    });

    // Gửi thông tin cập nhật sảnh chờ đến MỌI client đang kết nối
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// --- LOGIC RỜI PHÒNG (NỘI BỘ) ---
function leaveCurrentRoom(ws) {
    const currentRoomID = clientRoomMap.get(ws);
    if (currentRoomID) {
        const room = rooms.get(currentRoomID);
        if (room) {
            // Xóa kết nối khỏi danh sách phòng
            room.clients = room.clients.filter(client => client !== ws);
            
            // Nếu phòng không còn ai, xóa phòng đi
            if (room.clients.length === 0) {
                rooms.delete(currentRoomID);
                roomNameMap.delete(room.name); // <--- ĐIỀU CHỈNH: Xóa Tên phòng khỏi roomNameMap
                console.log(`Phòng ${room.name} đã bị xóa do không còn người chơi.`);
            }
        }
        clientRoomMap.delete(ws);
    }
}

// --- LOGIC THAM GIA PHÒNG (NỘI BỘ) ---
function joinRoom(ws, roomID) {
    const room = rooms.get(roomID);
    const username = clientUserMap.get(ws) || 'Guest';

    if (!room) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Phòng không tồn tại.' }));
        return;
    }
    
    if (room.clients.length >= room.maxPlayers) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Phòng đã đầy.' }));
        return;
    }
    
    // 1. Nếu client đang ở phòng khác, rời phòng đó trước
    leaveCurrentRoom(ws);
    
    // 2. Tham gia phòng mới
    room.clients.push(ws);
    clientRoomMap.set(ws, roomID);
    
    // 3. Thông báo cho client rằng họ đã sẵn sàng vào game
    ws.send(JSON.stringify({ type: 'GAME_READY', roomId: roomID }));
    
    console.log(`${username} đã tham gia phòng: ${room.name}. Tổng: ${room.clients.length}`);
    
    // Cập nhật sảnh chờ cho mọi người
    broadcastLobbyUpdate();
}

// ====================================================================
// --- XỬ LÝ KẾT NỐI VÀ LỆNH TỪ CLIENT ---
// ====================================================================

wss.on('connection', function connection(ws) {
    console.log('--- Một client mới đã kết nối. ---');

    // Gửi danh sách phòng ban đầu ngay khi kết nối
    broadcastLobbyUpdate();

    ws.on('message', function incoming(message) {
        let data;
        try {
            data = JSON.parse(message.toString());
        } catch (e) {
            console.error('Không phải JSON:', message.toString());
            // Đã chỉnh sửa: Logic game/broadcast ở đây chỉ xử lý JSON
            return; 
        }

        // --- LỆNH 1: ĐĂNG KÝ (REGISTER) ---
        if (data.type === 'REGISTER' && data.username) {
            clientUserMap.set(ws, data.username);
            console.log(`Client đăng ký: ${data.username}`);
            ws.send(JSON.stringify({ type: 'STATUS', message: 'Đăng ký thành công.' }));
            return;
        }

        // --- LỆNH 2: TẠO PHÒNG (CREATE_ROOM) ---
        // Turbowarp gửi: { type: "CREATE_ROOM", name: "Phòng của Vinh", maxPlayers: 4 }
        if (data.type === 'CREATE_ROOM' && data.name) {
            if (!clientUserMap.has(ws)) {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Vui lòng đăng ký tên trước khi tạo phòng.' }));
                return;
            }
            
            const roomName = data.name.trim(); // Loại bỏ khoảng trắng thừa
            const newRoomId = uuidv4();
            const maxPlayers = parseInt(data.maxPlayers) || 4; 

            // ĐIỀU CHỈNH: Kiểm tra tên phòng có bị trùng không
            if (roomNameMap.has(roomName)) {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Tên phòng đã tồn tại. Vui lòng chọn tên khác.' }));
                return;
            }
            
            rooms.set(newRoomId, {
                name: roomName,
                clients: [],
                maxPlayers: Math.min(maxPlayers, 8) 
            });
            roomNameMap.set(roomName, newRoomId); // <--- THÊM ÁNH XẠ TÊN -> UUID

            console.log(`Phòng mới được tạo: ${roomName} (${newRoomId})`);
            
            // Tự động tham gia phòng vừa tạo
            joinRoom(ws, newRoomId);
            return; 
        }

        // --- LỆNH 3: YÊU CẦU THAM GIA PHÒNG (REQUEST_JOIN) ---
        // Turbowarp gửi: { type: "REQUEST_JOIN", roomIdentifier: "Tên phòng Dễ nhớ HOẶC UUID" }
        if (data.type === 'REQUEST_JOIN' && data.roomIdentifier) {
            if (!clientUserMap.has(ws)) {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Vui lòng đăng ký tên trước khi tham gia phòng.' }));
                return;
            }
            
            const identifier = data.roomIdentifier.trim();
            let targetRoomId = identifier;

            // KIỂM TRA: Nếu Client gửi TÊN PHÒNG, tìm UUID tương ứng
            if (roomNameMap.has(identifier)) {
                targetRoomId = roomNameMap.get(identifier); // Lấy UUID thật
                console.log(`Đã chuyển Tên phòng '${identifier}' sang UUID: ${targetRoomId}`);
            } 
            // Nếu không tìm thấy tên, ta giả định nó là UUID

            joinRoom(ws, targetRoomId);
            return;
        }
        
        // --- LỆNH 4: CHAT SẢNH (CHAT) ---
        // (Giữ nguyên logic chat sảnh chờ)
        if (data.type === 'CHAT' && data.message) {
            const username = clientUserMap.get(ws) || 'Guest';
            const chatMessage = JSON.stringify({
                type: 'CHAT_MESSAGE',
                sender: username,
                message: data.message
            });
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(chatMessage);
                }
            });
            return;
        }

        // --- XỬ LÝ DỮ LIỆU GAME (BROADCAST TRONG PHÒNG) ---
        // Gửi bất kỳ JSON nào khác (dữ liệu vị trí, điểm, v.v.) đến người chơi cùng phòng
        const currentRoomID = clientRoomMap.get(ws);
        if (currentRoomID) {
            const room = rooms.get(currentRoomID);
            if (room) {
                room.clients.forEach(function each(client) {
                    // Không gửi lại cho người gửi
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(message.toString());
                    }
                });
            }
        }
    });

    // 4. Xử lý khi client ngắt kết nối
    ws.on('close', () => {
        const username = clientUserMap.get(ws) || 'Client (chưa đăng ký)';
        leaveCurrentRoom(ws); // Rời phòng nếu đang ở trong phòng
        clientUserMap.delete(ws); // Xóa tên người dùng
        
        console.log(`${username} ngắt kết nối.`);
        broadcastLobbyUpdate(); // Cập nhật sảnh chờ
    });
});

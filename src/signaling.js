//=====================================================================================================
//=====================================================================================================


const config = require('../config');
const mediasoup = require('mediasoup')
const Server = require('socket.io')  // server side
const io = new Server(httpsServer)
const connections = io.of('/mediasoup') //peer is for multiful connection so i changed name to conection

let worker
let rooms = {}          // { roomName1: { Router, peers: [ socketId1, ... ] }, ...}
let peers = {}          // { socketId1: { roomName1, socket, transports = [id1, id2,], producers = [id1, id2,] , consumers = [id1, id2,], peerDetails }, ...}
let transports = []     // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers = []      // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []      // [ { socketId1, roomName1, consumer, }, ... ]

const createWorker = async() => {
    worker = await mediasoup.createWorker(config.mediasoup.worker)
    console.log(`worker pid ${worker.pid}`)
    worker.on('died', error=> {
        console.error('mediasoup worker has died')
        setTimeout(()=>process.exit(1),2000) //2초 안에 탈출
    })
    return worker
}

const createWebRTCTransport = async(router)=>{
    return new Promise(async (resolve, reject) =>{
        try{
            const webRTCTransport_options = config.mediasoup.webRtcTransport
            let transport = await router.createWebRtcTransport(webRTCTransport_options)
            console.log(`transport id : ${transport.id}`)
            transport.on('dtls_statechange', dtlsState =>{
                if (dtlsState === 'closed'){
                    transport.close()
                }
            })
            transport.on('close',()=>{
                console.log('transport closed');
            })
            resolve(transport)
        }
        catch(error){
            console.log(error)
            reject(error)
        }
    })
}


worker = createWorker()

connections.on('connection', async socket=>{ // socket => client
    const addTransport = (transport, roomName, consumer) =>{
        transports = [
            ...transports,
            {socketId : socket.id, transport, roomName, consumer,}
        ]
        peers[socket.id] = {
            ...peers[socket.id],
            transports:[
                ...peers[socket.id].transports,
                transport.id,
            ]
        }
    }
    const addProducer = (producer,roomName) => {
        //add the producer to the producers list
        producers = [
            ...producers,
            {socketId : socket.id, producer, roomName,}
        ]
        //add producer id's to peer list
        peers[socket.id] = {
            ...peers[socket.id],
            producers:[
                ...peers[socket.id].producers,
                producer.id,
            ]
        }
    }
    const addConsumer = (consumer, roomName) =>{
        //add the consumer to the consumers list
        consumers = [
            ...consumers,
            {socketId : socket.id, consumer, roomName,}
        ]
        //add consumer id's to peer list
        peers[socket.id] = {
            ...peers[socket.id],
            consumers:[
                ...peers[socket.id].consumers,
                consumer.id,
            ]
        }
    }
    const removeItems = (items, socketId, type, kind) =>{
        if(kind){
            items.forEach(item => {
                if ((item.socketId === socketId) && (item.producer.kind === kind)) {
                item[type].close()
                }
            })
            items = items.filter(item => ((item.producer.kind !== kind) || (item.socketId !== socket.id)))
        }
        else{
            items.forEach(item => {
                if (item.socketId === socketId) {
                item[type].close()
                }
            })
            items = items.filter(item => item.socketId !== socket.id)
        }
        return items
    }
    console.log('socketID : ', socket.id)
    socket.emit('connection-success', {
        socketId: socket.id,
    })
    socket.on('joinRoom', async({roomName}, callback) => {
        // create router if room is note exist
        const router1 = await createRoom(roomName, socket.id)
        peers[socket.id] = {
            socket,
            roomName,
            transports : [],
            producers : [],
            consumers : [],
            peerDetails : {
                name : '',
                data : '',
                isAdmin : false, // Not update NOw
            }
        }
        // get Router RTP capabilities
        const rtpCapabilities = router1.rtpCapabilities
        // send to client
        callback({rtpCapabilities})
    })

    socket.on('disconnect', ()=>{
        //do some cleanup
        console.log('peer disconnected')
        consumers = removeItems(consumers, socket.id, 'consumer')
        producers = removeItems(producers, socket.id, 'producer')
        transports = removeItems(transports, socket.id, 'transport')
        // 임시방편으로 해두긴 했는데 잘 작동할지 모르겠다. 
        // (Finish 버튼을 누를 때 마지막 producer가 나가면 error 가 발생하는 것 예방용)
        if(peers[socket.id]){
            const {roomName} = peers[socket.id]
            delete peers[socket.id]
            // remove socket from room
            rooms[roomName] = {
            router: rooms[roomName].router,
            peers: rooms[roomName].peers.filter(socketId => socketId !== socket.id)
            }
        }
    })

    const createRoom = async(roomName, socketId) => {
        // worker.createRouter(options)
        // options = { mediaCodecs, appData }
        // mediaCodecs -> defined above
        // appData -> custom application data - we are not supplying any
        // none of the two are required
            let router1
            let peers = []
            if (rooms[roomName]) {
                router1 = rooms[roomName].router
                peers = rooms[roomName].peers || []
            } 
            else {
                router1 = await worker.createRouter(config.mediasoup.router)
            }
            console.log(`Router Id : ${router1.id}`, peers.length)
            rooms[roomName] = {
                router: router1,
                peers : [...peers, socketId]
            }
            console.log(rooms[roomName])
                return router1
        }

    socket.on('createWebRTCTransport',async({consumer}, callback)=>{
        // have to get room name from peer's properties
        const {roomName} = peers[socket.id] // 첫 producer를 통해 peers를 타고타고 roomName을 가져오는 방식
        const router = rooms[roomName].router
        createWebRTCTransport(router).then(
            transport => {
                callback({
                    params : {
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                    }
                })
                // add transport to peer's properties
                addTransport(transport, roomName, consumer)
            },
            error => {
                console.log(error.message)
            }
        )
    })

    //about producers
    socket.on('transport-connect', async ({ dtlsParameters}) =>{
        console.log('DTLS PARAMS...', {dtlsParameters})
        await getTransport(socket.id).connect({dtlsParameters})
    })
    const getTransport = (socketId) => {
        // check transport's scoket ID's same as passed in
        // this socketID is not consumered yet
        const [producerTransport] = transports.filter(transport => (transport.socketId === socketId) && !transport.consumer)
        return producerTransport.transport
    }

    socket.on('transport-produce',async({kind, rtpParameters, appData}, callback) =>{
        const producer = await getTransport(socket.id).produce({
            kind,
            rtpParameters
        })
        // add producer to the prodcer array
        const {roomName} = peers[socket.id];
        addProducer(producer, roomName)
        informConsumer(roomName, socket.id, producer.id, producer.kind)
        // get log for producer
        console.log('Producer ID : ', producer.id, producer.kind)
        producer.on('transportclose', ()=>{
            console.log('transport for this producer closed')
            producer.close()
        })
        callback({
            id : producer.id,
            producerExist : producers.length >= 1 ? true : false // client is just join when room is exist
        })
    })
    const informConsumer =(roomName, socketId, id, kind) =>{
        console.log(`Just joined!! id : ${id} - ${kind} to ${roomName}, ${socketId}`)
    // A new producer just joined
    // let all consumers to consume this producer
        producers.forEach(producerData => {
            if (producerData.socketId !== socketId && producerData.roomName === roomName) {
                const producerSocket = peers[producerData.socketId].socket
                // use socket to send producer id to producer
                // new producer will send his Id to all other consumers(producers)
                producerSocket.emit('new-producer', {producerId: id})
            }
        })    
    }
    
    socket.on('getProducers', callback => {
        //return all producer transports
        const { roomName } = peers[socket.id]
        let producerList = []
        producers.forEach(producerData => {
            if ((producerData.socketId !== socket.id) && (producerData.roomName === roomName)) {
            producerList = [...producerList, producerData.producer.id]
            }
        })
        // return the producer list back to the client
        callback(producerList)
    })

    //about recevers
    socket.on('transport-recv-connect', async({dtlsParameters, serverside_ConsumerTransportId})=> {
        console.log('DTLS PARAMS... for recv', {dtlsParameters})
        const consumerTransport = transports.find(transportData =>(
            transportData.consumer && (transportData.transport.id === serverside_ConsumerTransportId)
        )).transport
        await consumerTransport.connect({dtlsParameters})
    })

    socket.on('consume', async({rtpCapabilities, remoteProducerId, serverside_ConsumerTransportId}, callback) =>{
        try{
            const {roomName} = peers[socket.id]
            const router = rooms[roomName].router
            let consumerTransport = transports.find(transportData => (
                transportData.consumer && (transportData.transport.id === serverside_ConsumerTransportId)
            )).transport
            if(router.canConsume({
                producerId : remoteProducerId,
                rtpCapabilities,
            })){
                const consumer = await consumerTransport.consume({
                    producerId : remoteProducerId,
                    rtpCapabilities,
                    paused : true,  //have to resume this play back
                })
                
                consumer.on('transportclose',()=>{
                    console.log('transport close from consumer')
                })
                consumer.on('producerclose',()=>{
                    console.log('transport close from producer')
                    socket.emit('producer-closed', {remoteProducerId})
                    consumerTransport.close([])
                    transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id)
                    consumer.close()
                    consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id)                
                })
                addConsumer(consumer,roomName)
                const params = {
                    id : consumer.id,
                    producerId : remoteProducerId,
                    kind: consumer.kind,
                    rtpParameters : consumer.rtpParameters,
                    serverside_ConsumerId : consumer.id
                }
                callback({ params })
            }
        }catch(error)
        {
            console.log(error.message)
            callback({
                params : {
                    error:error
                }
            })
        }
    })
    socket.on('consumer-resume', async({serverside_ConsumerId})=>{
        console.log(`consumer ${serverside_ConsumerId} is resumed`)
        const { consumer } = consumers.find(consumerData => consumerData.consumer.id === serverside_ConsumerId)
        await consumer.resume()
        console.log("after : ",consumer.getStats())
    })

    socket.on('exitRoom', async({rtpCapabilities, remoteProducerId, serverside_ConsumerTransportId}, callback) =>{
        producers.forEach(producerData => console.log("아이디",producerData.producer.id, "종류", producerData.producer.kind))
        try{
            const {roomName} = peers[socket.id]
            const router = rooms[roomName].router
            let producerTransport = getTransport(socket.id)
            if(router.canConsume({
                producerId : remoteProducerId,
                rtpCapabilities,
            })){
                producerTransport.close([])
                if (!producers.find(producerData => (producerData.producer && (producerData.producer.id === remoteProducerId)))){
                    console.log("I can't find anything")
                }
                {
                    const producer = producers.find(producerData => (producerData.producer && (producerData.producer.id === remoteProducerId))).producer
                    producer.on('transportclose', ()=>{
                        console.log('producer exit')
                        producer.close([])
                    })
                    console.log('peer disconnected')
                }
                // 접속한producer데이터 삭제
                consumers = removeItems(consumers, socket.id, 'consumer')
                producers = removeItems(producers, socket.id, 'producer')
                transports = removeItems(transports, socket.id, 'transport')
                if(peers[socket.id]){
                    const {roomName} = peers[socket.id]
                    delete peers[socket.id]
                    // remove socket from room
                    rooms[roomName] = {
                    router: rooms[roomName].router,
                    peers: rooms[roomName].peers.filter(socketId => socketId !== socket.id)
                    }
                }
                callback()
            }
            else{
                console.log(error)
                console.log("이런거 주면 어떻게 받아먹냐;")
            }
            
        }catch(error){
            console.log(`${remoteProducerId} are not streaming `)
            console.log(error)
        }
    })

    socket.on('produceClose', async({rtpCapabilities, remoteProducerId, serverside_ConsumerTransportId}, callback) =>{
        try{
            producers.forEach(producerData => console.log("아이디",producerData.producer.id, "종류", producerData.producer.kind))
            const {roomName} = peers[socket.id]
            const router = rooms[roomName].router
            const producer = producers.find(producerData => (producerData.producer && (producerData.producer.id === remoteProducerId))).producer
            if(router.canConsume({
                producerId : remoteProducerId,
                rtpCapabilities,
            })){
                producer.close()
                console.log('producer closed', producer.kind)
                // 접속한producer데이터 삭제
                producers = removeItems(producers, socket.id, 'producer', producer.kind)
                if(peers[socket.id]){
                    peers[socket.id].producers.filter(producerId => producerId !== remoteProducerId)
                    // remove socket from room
                }
                callback()
            }
            
        }catch(error){
            console.log(`${remoteProducerId} producer not confirmed, but clicked btn`)
            console.log(error)
        }
    })
})

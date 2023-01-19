const fs = require('fs');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const https = require('httpolyglot');
const Server = require('socket.io')  // server side
const mediasoup = require('mediasoup')

app.use(bodyParser.urlencoded({extended : false}));
app.use(express.static('./src'));

app.use('/sfu', express.static(__dirname + "/public"))

app.get('/',(req, res)=>{
    res.send('hello from mediasoup app');
})

const options = {
    key : fs.readFileSync(__dirname + '/server/certs/key.pem','utf-8'), // have to get real ssl later
    cert : fs.readFileSync(__dirname + '/server/certs/cert.pem','utf-8')// have to get real ssl later
}

const httpsServer = https.createServer(options,app)
httpsServer.listen(3000,()=>{
    console.log("example app ")
})

const io = new Server(httpsServer)
const peers = io.of('/mediasoup')

let worker
let router
let producerTransport
let producer
let consumerTransport
let consumer


const createWorker = async() => {
    worker = await mediasoup.createWorker({
        rtcMinPort : 2000, // mediasoup에서 사용하는 기본 rtc port
        rtcMaxPort : 2020,
    })
    console.log(`worker pid ${worker.pid}`)
    worker.on('died', error=> {
        console.error('mediasoup worker has died')
        setTimeout(()=>process.exit(1),2000) //2초 안에 탈출
    })
    return worker
}

const createWebRTCTransport = async(callback)=>{
    try{
        const webRTCTransport_options = {
            listenIps :[{
                ip : '0.0.0.0', // server side ip have to changed
                announcedIp : '127.0.0.1' // this is our host machine
            }],
            enableUdp : true,
            enableTcp : true,
            preferUdp : true,
            preferTcp : false
        }
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
        callback({
            params : {
                id : transport.id,
                iceParameters : transport.iceParameters,
                iceCandidates : transport.iceCandidates,
                dtlsParameters : transport.dtlsParameters,
            }
        })
        return transport
    }catch(error){
        console.log(error)
        callback({
            params :{
                error : error
            }
        })
    }
}

worker = createWorker()

const mediaCodecs = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters:
        {
            'x-google-start-bitrate': 1000
        }
    }
]

peers.on('connection', async socket=>{ // socket => client
    console.log(socket.id)
    socket.emit('connection-success', {
        socketId: socket.id,
        existsProducer: producer ? true: false,
    })
    socket.on('disconnect', ()=>{
        //do some cleanup
        console.log('peer disconnected')
    })
 // we will use room at next step
    socket.on('createRoom', async(callback)=>{ // we get event for creating room
        if (router === undefined){ // router is representing room
            router = await worker.createRouter({mediaCodecs}) // if there is not router we will make router
        }
        getRtpCapabilities(callback)
    })

    const getRtpCapabilities = (callback) =>{
        const rtpCapabilities = router.rtpCapabilities
        callback({rtpCapabilities})
    }

    socket.on('createWebRTCTransport',async({sender}, callback)=>{
        console.log(`Is this a sender request ${sender}`) // sender = ture 인지 확인 
        if(sender)
        {
            producerTransport = await createWebRTCTransport(callback) // streamer
        }
        else{
            consumerTransport = await createWebRTCTransport(callback) // consumer
        }
    })
    //about producers
    socket.on('transport-connect', async({ dtlsParameters}) =>{
        console.log('DTLS PARAMS...', {dtlsParameters})
        await producerTransport.connect({dtlsParameters})
    })
    socket.on('transport-produce',async({kind, rtpParameters, appData}, callback) =>{
        producer = await producerTransport.produce({
            kind,
            rtpParameters
        })

        console.log('Producer ID : ', producer.id, producer.kind)
        producer.on('transportclose', ()=>{
            console.log('transport for this producer closed')
            producer.close()
        })
        callback({
            id : producer.id
        })
    })

    //about recevers
    socket.on('transport-recv-connect', async({dtlsParameters})=> {
        console.log('DTLS PARAMS...', {dtlsParameters})
        await consumerTransport.connect({dtlsParameters})
    })
    socket.on('consume', async({rtpCapabilities},callback) =>{
        try{
            if(router.canConsume({
                producerId : producer.id,
                rtpCapabilities
            })){
                consumer = await consumerTransport.consume({
                    producerId : producer.id,
                    rtpCapabilities,
                    paused : true  //have to resume this play back
                })
            }
            consumer.on('transportclose',()=>{
                console.log('transport close from consumer')
            })
            consumer.on('producerclose',()=>{
                console.log('transport close from producer')
            })
            const params = {
                id : consumer.id,
                producerId : producer.id,
                kind: consumer.kind,
                rtpParameters : consumer.rtpParameters
            }
            callback({params})
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
    socket.on('consumer-resume', async()=>{
        console.log('consumer resume')
        await consumer.resume()
    })

})

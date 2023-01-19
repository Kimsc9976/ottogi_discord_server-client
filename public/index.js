const io = require('socket.io-client') // client-side
const mediasoupClient = require('mediasoup-client')
const socket = io('/mediasoup')

// TCP/IP 통신은 일반적으로 sokect통신 이라고 부른다. 

socket.on('connection-success', ({socketId, existProducer}) => {
  console.log("--", socketId);
})

let device;
let rtpCapabilities;
let producerTransport;
let producer; //if some client is consumer -> we have to note that there is proudcer on server
let consumerTransport;
let consumer;

let isProducer = false;

let params = {
  //mediasoup params
  encoding : [
    {
      rid : 'r0',
      maxBitrate : 100000,
      scalabilityMode : 'S1T3'
    },
    {
      rid : 'r1',
      maxBitrate : 300000,
      scalabilityMode : 'S1T3'
    },
    {
      rid : 'r2',
      maxBitrate : 900000,
      scalabilityMode : 'S1T3'
    },
  ],
  codecOptions : {
    videoGoogleStartBitrate : 1000,

  }
}

const streamSuccess = (stream)=>{
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track, ...params
  }
  goConnect(true) // for producer
}

const getLocalStream = () =>{
  navigator.mediaDevices.getUserMedia({
    audio : false,
    video : {
      width : {
        min : 640,
        max : 1920
      },
      height : {
        min : 400,
        max : 1080
      }
    }
  }, streamSuccess, error=> {
    console.log(error.message);
  }).then(streamSuccess)
  .catch(error=>{
    console.log(error.message)
  })
}

//we have to notify for when we are connecting as consumer or producer
const goConnect = (producerORconsumer) =>{
  isProducer = producerORconsumer;
  device === undefined? getRtpCapabilities() : goCreateTransport() // do you have device ? No -> getRTPCapabilities // yes -> CreateTransport 
}

const goCreateTransport = () =>{
  isProducer ? createSendTransport() : createRecvTransport()
}

const goConsume = () =>{
  goConnect(false) // for consumer
}


const getRtpCapabilities = () =>{
  socket.emit('createRoom', (data) =>{
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    //we assign to local variable and will be used
    // console.log('data', data)
    rtpCapabilities = data.rtpCapabilities
    // once we have rtp capability, create device
    createDevice()
  })
}


const createDevice = async () =>{
  try{
    device = new mediasoupClient.Device()
    await device.load({
      routerRtpCapabilities : rtpCapabilities
    })

    console.log('Device RTP Capabilities', rtpCapabilities)
    //once the device load, create transport
    goCreateTransport()
  }catch (error)
  {
    console.log(error)
    if (error.name === 'UnsupportedError')
      {console.warn('browser not supported')}
  }
}

// --> create device 이후에, 시행해야함
//creating sendTransport

const createSendTransport = async ()=>{
  socket.emit('createWebRTCTransport',{sender : true}, ({params})=>{
    if (params.error){
      console.log(params.error)
      return
    }
    console.log(params)
    producerTransport = device.createSendTransport(params) // ready for send streaming data

    producerTransport.on('connect', async({dtlsParameters}, callback, error) =>{
      try{
        // signal of local DTLS parameters to the serverside transport
        await socket.emit('transport-connect',{
          // transportId : producerTransport.id,
          dtlsParameters : dtlsParameters,
        })

        // tell the transport that parameters were transmitted
        callback()
      }catch(error){
        errback(error)
      }
    })
    producerTransport.on('produce', async(parameters, callback, error) =>{
      console.log(parameters)
      try{
        await socket.emit('transport-produce',{
          // transportId : producerTransport.id,
          kind : parameters.kind,
          rtpParameters : parameters.rtpParameters,
          appData : parameters.appData          
        }, ({id}) => {
          // tell the transport that parameters were transmitted and provide
          // give producer's id for serverside
          callback(id)
        })
      }catch(error){
        errback(error)
      }
    })

    connectSendTransport()
  })
}

  // for connect [Send transport & produce]
const connectSendTransport = async()=>{
  producer = await producerTransport.produce(params) // this event will triggered when producer Transport start

  producer.on('trackened', ()=>{
    console.log('track ended')
    //close video tarck

  })

  producer.on('transportclose', ()=>{
    console.log('transport ended')
    //close video tarck
  })
}

// create receiver transport
const createRecvTransport = async ()=>{
  socket.emit('createWebRTCTransport',{sender : false}, ({params})=>{
    if (params.error){
      console.log(params.error)
      return
    }
    console.log(params)
    consumerTransport = device.createRecvTransport(params)
    consumerTransport.on('connect', async({dtlsParameters}, callback, error) =>{
      try{
        // signal of local DTLS parameters to the serverside transport
        await socket.emit('transport-recv-connect',{
          // transportId : consumerTransport.id,
          dtlsParameters : dtlsParameters,
        })
        // tell the transport that parameters were transmitted
        callback()
      }catch(error){
        errback(error)
      }
    })
    connectRecvTransport()
  })
}


const connectRecvTransport = async()=>{
  await socket.emit('consume',{
    rtpCapabilities : device.rtpCapabilities
  },async({params}) =>{
    if (params.error){
      console.log('Cannot consume')
      return
    }
    
    console.log(params)

    consumer = await consumerTransport.consume({
      id : params.id,
      producerId : params.producerId,
      kind : params.kind,
      rtpParameters : params.rtpParameters
    })

    const{track} = consumer

    remoteVideo.srcObject = new MediaStream([track])

    socket.emit('consumer-resume')
  })
}


// for prodcer -> get capability + createdevice + create send transport + connect sendTranseport & produce
// fur consumer -> get capability + createdevice + create receive transport + connect create receive transport
btnLocalVideo.addEventListener('click', getLocalStream)
btnRecvSendTransport.addEventListener('click', goConsume)
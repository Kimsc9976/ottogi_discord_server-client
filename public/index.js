const io = require('socket.io-client') // client-side
const mediasoupClient = require('mediasoup-client')
const socket = io('/mediasoup')

// TCP/IP 통신은 일반적으로 sokect통신 이라고 부른다. 

socket.on('connection-success', ({socketId}) => {
  console.log("--", socketId);
})

let device;
let rtpCapabilities;
let producerTransport;
let producer;
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

const streamSuccess = async (stream)=>{
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track, ...params
  }
}
const getLocalStream = () =>{
  navigator.getUserMedia({
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
  })
}

const getRtpCapabilities = () =>{
  socket.emit('getRtpCapabilities', (data) =>{
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    console.log('data', data)
    rtpCapabilities = data.rtpCapabilities
  })
}

const createDevice = async () =>{
  try{
    device = new mediasoupClient.Device()
    await device.load({
      routerRtpCapabilities : rtpCapabilities
    })
    console.log('RTP Capabilities', rtpCapabilities)
  }catch (error)
  {
    console.log(error)
    if (error.name === 'UnsupportedError')
      {console.warn('browser not supported')}
  }
}


btnLocalVideo.addEventListener('click', getLocalStream);
btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
btnDevice.addEventListener('click',createDevice)


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
  })
}

btnCreateSendTransport.addEventListener('click',createSendTransport)

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

btnConnectSendTransport.addEventListener('click',connectSendTransport)

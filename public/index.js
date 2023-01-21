const io = require('socket.io-client') // client-side
const mediasoupClient = require('mediasoup-client')
const socket = io('/mediasoup')

// TCP/IP 통신은 일반적으로 sokect통신 이라고 부른다. 

socket.on('connection-success', ({socketId, existProducer}) => {
  console.log("--", socketId);
  getLocalStream()
})

// if we don't supply it will be null
const roomName = window.location.pathname.split('/')[2]

let device;
let rtpCapabilities;
let producerTransport;
let producer; //if some client is consumer -> we have to note that there is proudcer on server
let consumerTransports = [];
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

// about streaming
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

const streamSuccess = (stream)=>{
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track, ...params
  }
  joinRoom() 
}
// 
const joinRoom = () =>{ // to make router or go to router
  socket.emit('joinRoom', {roomName}, (data) => {
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    //we assign to local variable and will be used
    // console.log('data', data)
    rtpCapabilities = data.rtpCapabilities
    // once we have rtp capability, create device
    createDevice()
  })
}

// make device when we join the room
const createDevice = async () =>{
  try{
    device = new mediasoupClient.Device()
    await device.load({
      routerRtpCapabilities : rtpCapabilities
    })
    console.log('Device RTP Capabilities', rtpCapabilities)
    //once the device load, create transport
    // goCreateTransport() // For 1:1 Connection

    createSendTransport() // this cuz for everyone is producer & consumer
  }catch (error)
  {
    console.log(error)
    if (error.name === 'UnsupportedError')
      {console.warn('browser not supported')}
  }
}
//========================================================================================================== 
//================================ For create Send Transport =============================================== 
//========================================================================================================== 
const createSendTransport = async ()=>{
  // TODO : 영상 통화 및 음성통화 분리시 consumer 부분 변경이 필요함
  //        어떠한 방식으로 접근을 했는지 state를 알려줘야하는게 중요한 부분 같음
  await socket.emit('createWebRTCTransport',{consumer : false}, ({params})=>{
    if (params.error){
      console.log(params.error)
      return
    }
    console.log(params)
    producerTransport = device.createSendTransport(params) // ready for send streaming data
    producerTransport.on('connect', async({dtlsParameters}, callback, errback) =>{
      try{
        // signal of local DTLS parameters to the serverside transport
        await socket.emit('transport-connect',{
          // transportId : producerTransport.id,
          dtlsParameters,
        })
        // tell the transport that parameters were transmitted
        callback()
      }catch(error){
        errback(error)
      }
    })
    producerTransport.on('produce', async(parameters, callback, errback) =>{
      console.log(parameters)
      try{
        // Room에 Producer가 있으면, router를 생성할 필요가 없기 떄문에 Producer가 있는지 물어봐야함 
        await socket.emit('transport-produce',{
          // transportId : producerTransport.id,
          kind : parameters.kind,
          rtpParameters : parameters.rtpParameters,
          appData : parameters.appData          
        }, ({id, producerExist}) => {
          // tell the transport that parameters were transmitted and provide
          // give producer's id for serverside
          callback({id, producerExist})
          if(producerExist){
            getProducers()
          }
        })
      }catch(error){
        errback(error)
      }
    })
    connectSendTransport()
  })
}
// server have to inform the client of a new producer just joined // and ready for consume
socket.on('new-producer',({producerId}) => signalNewConsumerTransport(producerId))
const getProducers = () => {
  socket.emit('getProducers', (producerIds) =>{
    console.log("producer Ids", producerIds)
    // producerIds.forEach(id => signalNewConsumerTransport(id)) 
    producerIds.forEach(signalNewConsumerTransport)
  })
}
// ======
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
//==========================================================================================================
//==========================================================================================================
//========================================================================================================== 


//========================================================================================================== 
//=============================== For create Receiver Transport ============================================ 
//========================================================================================================== 
const signalNewConsumerTransport = async (remoteProducerId)=>{
  //check if we are already consuming the remoteProducerId
  await socket.emit('createWebRTCTransport',{consumer : true}, ({params})=>{
    if (params.error){
      console.log(params.error)
      return
    }
    let consumerTransport;
    try {
      consumerTransport = device.createRecvTransport(params)
    } catch (error) {
      console.log(error)
      return
    }
    consumerTransport.on('connect', async({dtlsParameters}, callback, errback) =>{
      try{
        // signal of local DTLS parameters to the serverside transport
          await socket.emit('transport-recv-connect',{
            // transportId : consumerTransport.id,
            dtlsParameters : dtlsParameters,
            serverside_ConsumerTransportId : params.id
          })
          // tell the transport that parameters were transmitted
          callback()
      }catch(error){
        errback(error)
      }
    })
    connectRecvTransport(consumerTransport, remoteProducerId, params.id)
    // [ params.id ] is "server side" consumer transpor id
    // this is transported by server 'createWebRTCTransport' 
  })
}

const connectRecvTransport = async(consumerTransport, remoteProducerId, serverside_ConsumerTransportId)=>{
  await socket.emit('consume',{
    rtpCapabilities : device.rtpCapabilities,
    remoteProducerId,
    serverside_ConsumerTransportId,
  },
  async({params}) =>{
    if (params.error){
      console.log('Cannot consume')
      return
    }
    
    console.log(`Consumer Params ${params}`)
    const consumer = await consumerTransport.consume({
      id : params.id,
      producerId : params.producerId,
      kind : params.kind,
      rtpParameters : params.rtpParameters
    })

    consumerTransports = [
      ...consumerTransports,
      {
        consumerTransport,
        serverside_ConsumerTransportId : params.id,
        producerId : remoteProducerId,
        consumer,
      }
    ]
    const newElem = document.createElement('div')
    newElem.setAttribute('id', `td-${remoteProducerId}`)
    newElem.setAttribute('class','remoteVideo')
    newElem.innerHTML = `<video id="${remoteProducerId}" autoplay class = "video"></video>`
    videoContainer.appendChild(newElem);

    const {track} = await consumer
    console.log("트랙 여기있다.",track)
    // remoteVideo.srcObject = new MediaStream([track]) //this is for 1-1 connection 
    document.getElementById(remoteProducerId).srcObject = new MediaStream([track])

    // socket.emit('consumer-resume')//this is for 1-1 connection 
    console.log("씨발..",params.serverside_ConsumerId)
    socket.emit('consumer-resume', {serverside_ConsumerId : params.serverside_ConsumerId})
  })
}
//==========================================================================================================
//==========================================================================================================
//========================================================================================================== 



// for prodcer(getLocalStream) -> get capability + createdevice + create send transport + connect sendTranseport & produce
// fur consumer(go consume) -> get capability + createdevice + create receive transport + connect create receive transport


socket.on('producer-closed', ({remoteProducerId})=>{
  //server notification is received when producer closed streaming
  //we need to close the client-side consumer and associated transport
  const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
  console.log("닫을거 친절히",producerToClose)
  producerToClose.consumerTransport.close()
  producerToClose.consumer.close()
  consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)
  videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
})
// 디스코드에서는 사용하니까 일단은 남겨두었다.
// btnLocalVideo.addEventListener('click', getLocalStream)
// btnRecvSendTransport.addEventListener('click', goConsume)
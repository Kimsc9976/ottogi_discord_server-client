const io = require('socket.io-client') // client-side
const mediasoupClient = require('mediasoup-client')
const socket = io('/mediasoup')

// TCP/IP 통신은 일반적으로 sokect통신 이라고 부른다. 

socket.on('connection-success', ({socketId, existProducer}) => {
  console.log('--', socketId, 'Enters the room.', existProducer);

})

// if we don't supply it will be null
const roomName = window.location.pathname.split('/')[2]

let Streaming
let isStreaming = false

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
  if(isStreaming  === true){
    console.log("already streaming")
    return
  }
  Streaming = navigator.mediaDevices.getUserMedia({
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
  isStreaming = true
  localVideo.srcObject = stream;
  Streaming = stream
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
    console.log("params  : ",params)
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


// for connect [Send transport & produce]
const connectSendTransport = async()=>{
  // Warning! [readystate가 왜 업데이트가 안되는지 파악이 안됨.... (Refresh가 되지 않음)] 23.01.24 -> readonly라 직접변경은 안됨
  params.track.enabled = true // 따라서 임의로 꺼내서 사용중인데, 조건을 주어 제어를 할 필요 있음

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

// server have to inform the client of a new producer just joined // and ready for consume
socket.on('new-producer',({producerId}) => signalNewConsumerTransport(producerId))
const getProducers = () => {
  socket.emit('getProducers', (producerIds) =>{
    console.log("producer Ids", producerIds)
    producerIds.forEach(id => signalNewConsumerTransport(id)) 
    // producerIds.forEach(signalNewConsumerTransport)
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
    console.log(`PARAMS... ${params}`)
    let consumerTransport;
    try {
      consumerTransport = device.createRecvTransport(params)
    } catch (error) {
      // exceptions: 
      // {InvalidStateError} if not loaded
      // {TypeError} if wrong arguments.
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
    
    console.log(`Consumer Params ${{params}}`)
    const consumer = await consumerTransport.consume({
      id : params.id,
      producerId : params.producerId,
      kind : params.kind,
      rtpParameters : params.rtpParameters,
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

//============ 후에 펑션으로 업데이트 시키기
    createVideo(false, remoteProducerId)
//========================================
    const {track} = await consumer
    // remoteVideo.srcObject = new MediaStream([track]) //this is for 1-1 connection 
    document.getElementById(remoteProducerId).srcObject = new MediaStream([track])
    // socket.emit('consumer-resume')//this is for 1-1 connection 
    socket.emit('consumer-resume', {serverside_ConsumerId : params.serverside_ConsumerId})
  })
}
//==========================================================================================================
//==========================================================================================================
//========================================================================================================== 



// for prodcer(getLocalStream) -> get capability + createdevice + create send transport + connect sendTranseport & produce
// fur consumer(go consume) -> get capability + createdevice + create receive transport + connect create receive transport

socket.on('producer-closed', async({remoteProducerId})=>{
  //server notification is received when producer closed streaming
  //we need to close the client-side consumer and associated transport
//========= 상대방 종료시 데이터 삭제
  await deleteVideo(false, remoteProducerId)
//==============================
  isStreaming = false
})

const finishStream = async () =>{ // ProducerId : 내 아이디 , remoteProducerIds : Consumers의 정보들 
  /// 정보 지워버리기.
  // can find with consumerTransports
  console.log(producer)
  try{
    if(producer)
    {
      console.log("Producer exited roomdd")
      await socket.emit('exitRoom',{
        rtpCapabilities : device.rtpCapabilities,
        remoteProducerId : producer.id,
        serverside_ConsumerTransportId : producerTransport.id,
        producer,
      }, async()=>{
        await deleteVideo(true)
        
        // 23.01.24 stop 함수 이용시 readState 가 ended로 업데이트 되고, 이후 refresh가 되지 않음
        // enabled를 false true 로 작업하면 이런 문제를 방지할 수 있던데, 더 최적화를 해야할 필요가 있음
        producer.enabled = false
        producerTransport.enabled = false
        Streaming.getVideoTracks()[0].enabled = false
      })
    }
  }catch(error){
    console.log(error)
  }
}

const createVideo = async(isProducer = false, ProducerId) =>{
  if(isProducer === false)
  {
    try{
      const newElem = document.createElement('div')
      newElem.setAttribute('id', `td-${ProducerId}`)
      newElem.setAttribute('class','remoteVideo')
      newElem.innerHTML = `<video id="${ProducerId}" autoplay class = "video"></video>`
      videoContainer.appendChild(newElem);
    }catch(error){
      console.log("cannot make other usres video")
      throw error
    }
  }

  if(isProducer === true)
  {
    // 검은색 칸이 보기 싫다면 업데이트 하기

  }

}

const deleteVideo = async(isProducer = false, remoteProducerId) =>{
  try{
    if(isProducer ===false) // remoteProducer가 streaming종료
    {
      const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
      producerToClose.consumerTransport.close()
      producerToClose.consumer.close()
      consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)
      videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
    }

    if(isProducer ===true)
    {
      consumerTransports.forEach(transportData =>  deleteVideo(false, transportData.producerId))
    }
    //==============================
    isStreaming = false
  }catch(error){
    console.log(error)
    throw error
  }
}



btnLocalVideo.addEventListener('click', getLocalStream)
btnFinishStream.addEventListener('click', finishStream)
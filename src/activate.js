const config = require('../config')
const socket = config.socket


let Consumer
let consumerTransports = []

exports.connectRecvTransport = async(consumerTransport, remoteProducerId, serverside_ConsumerTransportId)=>{
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
    
    console.log(`Consumer Params ${params.kind}`)
    Consumer = await consumerTransport.consume({
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
        Consumer,
      }
    ]
  })

  return {
    consumer : {
      consume : Consumer, 
      id : params.id, 
      kind : params.kind
    }, 
    consumer_Transports : consumerTransports
  }
}

exports.closeProducer = async(producer, rtpCapabilities, producerTransport) =>{
  await socket.emit('produceClose',{
    rtpCapabilities : rtpCapabilities,
    remoteProducerId : producer.id,
    serverside_ConsumerTransportId : producerTransport.id,
  }, async()=>{
    // await deleteVideo(false, to_erase)
    producer.close()
    producer.on('trackened', ()=>{
      console.log('track ended')
      //close video tarck
    })
    producer.on('transportclose', ()=>{
      console.log('transport ended')
      //close video tarck
    })
    
  })
  producer = undefined
  return producer
}

exports.closeTransport = async(video, audio, screen, producerTransport, rtpCapabilities) =>{
  console.log("비디오",video)
  console.log("오디오",audio)
  try{
    if(video || audio)
    {
      let producer;
      producer = video || audio
      console.log(1)
      await socket.emit('exitRoom',{
        rtpCapabilities : rtpCapabilities,
        remoteProducerId : producer.id, 
        serverside_ConsumerTransportId : producerTransport.id,
      }, async()=>{
        console.log(2)
        producer.close()
        producerTransport.close()
        console.log(3)
        producer.on('trackened', ()=>{
          console.log('track ended')
          //close video tarck
        })
        console.log(4)
        producer.on('transportclose', ()=>{
          console.log('transport ended')
          //close video tarck
        })
        console.log(5)
      })
    }
    else{
      console.log("Noting to close")
      return;
    }
  }catch(error){
    console.log("안녕;")
    console.log(error.message)
  }
}
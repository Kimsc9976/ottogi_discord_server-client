const config = require('../config')
const socket = config.socket


exports.closeProducer = async(producer) =>{
  await socket.emit('produceClose',{
    rtpCapabilities : device.rtpCapabilities,
    remoteProducerId : producer.id,
    serverside_ConsumerTransportId : producerTransport.id,
  }, async()=>{
    // await deleteVideo(false, to_erase)
    producer.close()
    producer = undefined
    producer.on('trackened', ()=>{
      console.log('track ended')
      //close video tarck
    })
    producer.on('transportclose', ()=>{
      console.log('transport ended')
      //close video tarck
    })
  })
}




exports.addTransport = async (transports, peers, socketId, transport, roomName, consumer) =>{
  transports = [
      ...transports,
      {socketId, transport, roomName, consumer,}
  ]
  peers[socketId] = {
      ...peers[socketId],
      transports:[
          ...peers[socketId].transports,
          transport.id,
      ]
  }
  return {transports, peers}
}


exports.Producer = async(producerTransport, Params) => {
  Producer = await producerTransport.produce(Params) // this event will triggered when producer Transport start
  console.log(`${Params.track.kind} - ${Producer.id} confirmed`)
  Producer.on('trackened', ()=>{
    console.log('track ended')
    //close video tarck
  })
  Producer.on('transportclose', ()=>{
    console.log('transport ended')
    //close video tarck
  })
  return Producer
}


let Streaming
exports.streamSuccess = async (audioParams, stream)=>{
  isStreaming = true
  localVideo.srcObject = stream;
  Streaming = stream
  btnFinishStream.disabled = false
  btnLocalVideo.disabled = false
  btnLocalStream.disabled = true
  // btnLocalScrean.disabled = false

  audioParams= { track: stream.getAudioTracks()[0], ...audioParams };
  console.log("audioParams",audioParams)
  return {audioParams, Streaming}
}


exports.addvideo = (videoParams, stream) =>{
  isVideoON = true
  const videoTracks = stream.getVideoTracks();
  Streaming.addTrack(videoTracks[0])
  localVideo.srcObject = null;
  localVideo.srcObject = Streaming;
  
  videoParams = { track: stream.getVideoTracks()[0], ...videoParams };
  console.log("videoParams",videoParams)

  return {videoParams, Streaming}
}
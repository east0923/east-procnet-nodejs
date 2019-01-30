../node_modules/protobufjs/bin/pbjs -t json plant.proto >plant.json

protoc --python_out=./ plant.proto
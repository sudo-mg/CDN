const sqlite = require('sqlite3')
const fs = require('fs')
const dns2 = require('dns2')

const { Packet } = dns2

let coordinates = JSON.parse(fs.readFileSync('./databases/coordinates.json'))
let datacenters = JSON.parse(fs.readFileSync('./databases/datacenters.json'))

class Router {
    #database = new sqlite.Database('./databases/locations.dat', error => {
        if (error) {
            throw error
        }
    })
    
    /**
     * Route using Geolocation from IP
     * @param {String} ip 
     * @param {Function} callback 
     */
    route(ip, callback) {
        // Gets the current IP's country coordinates
        let part = ip.split('.')
        let decimalIp = ((((((+part[0])*256)+(+part[1]))*256)+(+part[2]))*256)+(+part[3])
        
        this.#database.get('SELECT country_code FROM location WHERE decimal_ip < ? ORDER BY decimal_ip DESC LIMIT 0, 1', [decimalIp], function(error, data) {
            
            if (data != undefined ? typeof data['country_code'] == 'string' : false) {
                // Computes the NN data center
                let clientPoint = coordinates[data['country_code'] == 'eu' ? 'fr' : data['country_code']]
                let nearest = {}
                
                for (let countryCode in datacenters) {
                    let serverPoint = coordinates[countryCode]
                    // Server-client's euclidean distance ratio
                    let distance = Math.pow(clientPoint[0] - serverPoint[0], 2) + Math.pow(clientPoint[1] - serverPoint[1], 2)
                    
                    if ('distance' in nearest ? distance < nearest['distance'] : true) {
                        nearest['distance'] = distance
                        nearest['country_code'] = countryCode
                    }
                }

                callback(datacenters[nearest['country_code']])

                console.log(`${ip} [${data['country_code']}] -> ${datacenters[nearest['country_code']]} [${nearest['country_code']}]`)
            } else {
                console.warn('No records for this IP address, giving default route.')
                // Default main route: US's data center
                callback(datacenters['us'])
            }
        })
    }
}

let router = new Router()

dns2.createServer({
    udp: true,
    handle: (request, send, client) => {
        const response = Packet.createResponseFromRequest(request);
        const [ question ] = request.questions;
        const { name } = question;
        
        // Routes DNS requests by Geo IP
        router.route(client.address, function(datacenterIp) {

            response.answers.push({
                name,
                type: Packet.TYPE.A,
                class: Packet.CLASS.IN,
                ttl: 0,
                address: datacenterIp
            })

            send(response)
        })
    }
}).listen({ udp: 53 })

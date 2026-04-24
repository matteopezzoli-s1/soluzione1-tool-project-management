// v0.1.2-beta
import express from 'express'

const app = express()
const PORT = process.env.PORT || 8080

app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
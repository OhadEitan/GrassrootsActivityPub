curl -X POST https://localhost:3000/send-message ^
  -H "Content-Type: application/json" ^
  -d "{\"sender\": \"Alice\", \"recipient\": \"Bob\", \"content\": \"Hello Bob, how are you?\"}" -k
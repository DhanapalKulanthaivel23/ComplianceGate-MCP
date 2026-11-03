// Command compliancegate-core provides the Go screening engine, format parser,
// REST pre-screen API, and JSON-RPC 2.0 MCP server over stdio and HTTP.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/compliancegate/compliancegate-core/pkg/engine"
	"github.com/compliancegate/compliancegate-core/pkg/lists"
	"github.com/compliancegate/compliancegate-core/pkg/model"
	"github.com/compliancegate/compliancegate-core/pkg/parsers"
)

type jsonRpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonRpcResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id"`
	Result  interface{} `json:"result,omitempty"`
	Error   interface{} `json:"error,omitempty"`
}

func handleMcpRpc(req jsonRpcRequest, eng *engine.ScreeningEngine, repo *lists.WatchlistRepository, pf *parsers.UnifiedParserFactory) jsonRpcResponse {
	switch req.Method {
	case "initialize":
		return jsonRpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]interface{}{
				"protocolVersion": "2024-11-05",
				"serverInfo": map[string]string{
					"name":    "compliancegate-core-go",
					"version": "1.0.0",
				},
				"capabilities": map[string]interface{}{
					"tools": map[string]interface{}{},
				},
			},
		}
	case "tools/list":
		return jsonRpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]interface{}{
				"tools": []map[string]interface{}{
					{"name": "screen_entity", "description": "Screen a canonical entity through the Go in-memory screening engine"},
					{"name": "parse_and_screen_message", "description": "Parse SWIFT MT or ISO 20022 MX and screen all extracted entities in Go"},
					{"name": "list_status", "description": "Return Go watchlist repository status and version hash"},
				},
			},
		}
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		_ = json.Unmarshal(req.Params, &p)
		switch p.Name {
		case "screen_entity":
			var entity model.ScreenableEntity
			_ = json.Unmarshal(p.Arguments, &entity)
			res := eng.ScreenEntity(entity, 0.80)
			b, _ := json.Marshal(res)
			return jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"content": []map[string]string{{"type": "text", "text": string(b)}},
				},
			}
		case "parse_and_screen_message":
			var args struct {
				RawMessage string `json:"rawMessage"`
			}
			_ = json.Unmarshal(p.Arguments, &args)
			txs, hdr, err := pf.ParseTransactions(args.RawMessage)
			if err != nil {
				return jsonRpcResponse{
					JSONRPC: "2.0",
					ID:      req.ID,
					Error:   map[string]interface{}{"code": -32602, "message": err.Error()},
				}
			}
			var entities []model.ScreenableEntity
			for _, tx := range txs {
				entities = append(entities, tx.Entities...)
			}
			res := eng.ScreenMessage(hdr.Family, hdr.MessageType, entities, 0.80)
			if !hdr.IsProfileTested {
				res.Disposition = "MANUAL_REVIEW_REQUIRED"
			}
			b, _ := json.Marshal(res)
			return jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"content": []map[string]string{{"type": "text", "text": string(b)}},
				},
			}
		case "list_status":
			b, _ := json.Marshal(repo.GetStatus())
			return jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"content": []map[string]string{{"type": "text", "text": string(b)}},
				},
			}
		}
	}
	return jsonRpcResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
		Error:   map[string]interface{}{"code": -32601, "message": "Method not found: " + req.Method},
	}
}

func main() {
	screenEntityFlag := flag.String("screen-entity", "", "JSON ScreenableEntity payload to screen")
	parseMsgFlag := flag.String("parse-message", "", "Raw SWIFT MT or ISO 20022 MX message to parse and screen")
	listStatusFlag := flag.Bool("list-status", false, "Output watchlist status JSON")
	stdioMcpFlag := flag.Bool("stdio-mcp", false, "Run JSON-RPC 2.0 MCP server over stdio")
	httpAddrFlag := flag.String("http", "", "Listen address for Go Pre-screen & MCP HTTP API (e.g. :8080)")
	flag.Parse()

	repo := lists.NewWatchlistRepository(os.Getenv("DATA_DIR"))
	eng := engine.NewScreeningEngine(repo)
	pf := parsers.NewUnifiedParserFactory()

	if *listStatusFlag {
		b, _ := json.Marshal(repo.GetStatus())
		fmt.Println(string(b))
		return
	}

	if *screenEntityFlag != "" {
		var entity model.ScreenableEntity
		if err := json.Unmarshal([]byte(*screenEntityFlag), &entity); err != nil {
			fmt.Fprintf(os.Stderr, `{"error":%q}`+"\n", err.Error())
			os.Exit(1)
		}
		res := eng.ScreenEntity(entity, 0.80)
		b, _ := json.Marshal(res)
		fmt.Println(string(b))
		return
	}

	if *parseMsgFlag != "" {
		txs, hdr, err := pf.ParseTransactions(*parseMsgFlag)
		if err != nil {
			fmt.Fprintf(os.Stderr, `{"error":%q}`+"\n", err.Error())
			os.Exit(1)
		}
		var entities []model.ScreenableEntity
		for _, tx := range txs {
			entities = append(entities, tx.Entities...)
		}
		res := eng.ScreenMessage(hdr.Family, hdr.MessageType, entities, 0.80)
		if !hdr.IsProfileTested {
			res.Disposition = "MANUAL_REVIEW_REQUIRED"
		}
		out := map[string]interface{}{
			"header":       hdr,
			"transactions": txs,
			"screening":    res,
		}
		b, _ := json.Marshal(out)
		fmt.Println(string(b))
		return
	}

	if *stdioMcpFlag {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var req jsonRpcRequest
			if err := json.Unmarshal([]byte(line), &req); err != nil {
				continue
			}
			resp := handleMcpRpc(req, eng, repo, pf)
			b, _ := json.Marshal(resp)
			fmt.Println(string(b))
		}
		return
	}

	if *httpAddrFlag != "" {
		mux := http.NewServeMux()
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "HEALTHY",
				"engine": "compliancegate-core-go",
				"lists":  repo.GetStatus(),
			})
		})
		mux.HandleFunc("/api/screen/entity", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			var entity model.ScreenableEntity
			if err := json.NewDecoder(r.Body).Decode(&entity); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			_ = json.NewEncoder(w).Encode(eng.ScreenEntity(entity, 0.80))
		})
		mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			body, _ := io.ReadAll(r.Body)
			var req jsonRpcRequest
			_ = json.Unmarshal(body, &req)
			_ = json.NewEncoder(w).Encode(handleMcpRpc(req, eng, repo, pf))
		})
		_ = http.ListenAndServe(*httpAddrFlag, mux)
	}
}


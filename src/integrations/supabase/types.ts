export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      categorias: {
        Row: {
          cor: string | null
          created_at: string
          icone: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          icone?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          icone?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      consumos_internos: {
        Row: {
          created_at: string
          id: string
          motivo: Database["public"]["Enums"]["motivo_consumo"]
          observacao: string | null
          produto_id: string
          quantidade: number
          sala_id: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          motivo: Database["public"]["Enums"]["motivo_consumo"]
          observacao?: string | null
          produto_id: string
          quantidade: number
          sala_id: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          motivo?: Database["public"]["Enums"]["motivo_consumo"]
          observacao?: string | null
          produto_id?: string
          quantidade?: number
          sala_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumos_internos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumos_internos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumos_internos_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumos_internos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          added_at: string
          conversation_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          conversation_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          conversation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          owner_user_id: string | null
          related_emprestimo_id: string | null
          related_requisicao_id: string | null
          sala_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          owner_user_id?: string | null
          related_emprestimo_id?: string | null
          related_requisicao_id?: string | null
          sala_id?: string | null
          title?: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          owner_user_id?: string | null
          related_emprestimo_id?: string | null
          related_requisicao_id?: string | null
          sala_id?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_related_emprestimo_id_fkey"
            columns: ["related_emprestimo_id"]
            isOneToOne: false
            referencedRelation: "emprestimos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_related_requisicao_id_fkey"
            columns: ["related_requisicao_id"]
            isOneToOne: false
            referencedRelation: "solicitacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      devolucao_itens: {
        Row: {
          devolucao_id: string
          emprestimo_item_id: string
          id: string
          produto_id: string
          quantidade: number
          valor_total: number | null
          valor_unitario_aplicado: number | null
        }
        Insert: {
          devolucao_id: string
          emprestimo_item_id: string
          id?: string
          produto_id: string
          quantidade: number
          valor_total?: number | null
          valor_unitario_aplicado?: number | null
        }
        Update: {
          devolucao_id?: string
          emprestimo_item_id?: string
          id?: string
          produto_id?: string
          quantidade?: number
          valor_total?: number | null
          valor_unitario_aplicado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "devolucao_itens_devolucao_id_fkey"
            columns: ["devolucao_id"]
            isOneToOne: false
            referencedRelation: "devolucoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_emprestimo_item_id_fkey"
            columns: ["emprestimo_item_id"]
            isOneToOne: false
            referencedRelation: "emprestimo_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_emprestimo_item_id_fkey"
            columns: ["emprestimo_item_id"]
            isOneToOne: false
            referencedRelation: "v_emprestimo_itens_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
        ]
      }
      devolucoes: {
        Row: {
          created_at: string
          emprestimo_id: string
          id: string
          observacao: string | null
          usuario_id: string
        }
        Insert: {
          created_at?: string
          emprestimo_id: string
          id?: string
          observacao?: string | null
          usuario_id: string
        }
        Update: {
          created_at?: string
          emprestimo_id?: string
          id?: string
          observacao?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devolucoes_emprestimo_id_fkey"
            columns: ["emprestimo_id"]
            isOneToOne: false
            referencedRelation: "emprestimos"
            referencedColumns: ["id"]
          },
        ]
      }
      dividas: {
        Row: {
          id: string
          produto_id: string
          sala_credora_id: string
          sala_devedora_id: string
          saldo: number
          updated_at: string
          valor_financeiro: number
        }
        Insert: {
          id?: string
          produto_id: string
          sala_credora_id: string
          sala_devedora_id: string
          saldo?: number
          updated_at?: string
          valor_financeiro?: number
        }
        Update: {
          id?: string
          produto_id?: string
          sala_credora_id?: string
          sala_devedora_id?: string
          saldo?: number
          updated_at?: string
          valor_financeiro?: number
        }
        Relationships: [
          {
            foreignKeyName: "dividas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_sala_credora_id_fkey"
            columns: ["sala_credora_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_sala_devedora_id_fkey"
            columns: ["sala_devedora_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      emprestimo_itens: {
        Row: {
          emprestimo_id: string
          id: string
          produto_id: string
          quantidade: number
          quantidade_devolvida: number
          valor_total: number | null
          valor_unitario_aplicado: number | null
        }
        Insert: {
          emprestimo_id: string
          id?: string
          produto_id: string
          quantidade: number
          quantidade_devolvida?: number
          valor_total?: number | null
          valor_unitario_aplicado?: number | null
        }
        Update: {
          emprestimo_id?: string
          id?: string
          produto_id?: string
          quantidade?: number
          quantidade_devolvida?: number
          valor_total?: number | null
          valor_unitario_aplicado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "emprestimo_itens_emprestimo_id_fkey"
            columns: ["emprestimo_id"]
            isOneToOne: false
            referencedRelation: "emprestimos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimo_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimo_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
        ]
      }
      emprestimos: {
        Row: {
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          id: string
          observacao: string | null
          retirado_em: string | null
          retirado_por: string | null
          sala_destino_id: string
          sala_origem_id: string
          solicitante_id: string | null
          status: Database["public"]["Enums"]["emprestimo_status"]
        }
        Insert: {
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          id?: string
          observacao?: string | null
          retirado_em?: string | null
          retirado_por?: string | null
          sala_destino_id: string
          sala_origem_id: string
          solicitante_id?: string | null
          status?: Database["public"]["Enums"]["emprestimo_status"]
        }
        Update: {
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          id?: string
          observacao?: string | null
          retirado_em?: string | null
          retirado_por?: string | null
          sala_destino_id?: string
          sala_origem_id?: string
          solicitante_id?: string | null
          status?: Database["public"]["Enums"]["emprestimo_status"]
        }
        Relationships: [
          {
            foreignKeyName: "emprestimos_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimos_sala_destino_id_fkey"
            columns: ["sala_destino_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimos_sala_origem_id_fkey"
            columns: ["sala_origem_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimos_solicitante_id_fkey"
            columns: ["solicitante_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entradas_estoque: {
        Row: {
          created_at: string
          data_entrada: string
          fornecedor: string | null
          id: string
          numero_nf: string | null
          observacao: string | null
          produto_id: string
          quantidade: number
          sala_id: string
          usuario_responsavel: string | null
          usuario_responsavel_nome: string | null
          valor_total: number | null
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          data_entrada?: string
          fornecedor?: string | null
          id?: string
          numero_nf?: string | null
          observacao?: string | null
          produto_id: string
          quantidade: number
          sala_id: string
          usuario_responsavel?: string | null
          usuario_responsavel_nome?: string | null
          valor_total?: number | null
          valor_unitario: number
        }
        Update: {
          created_at?: string
          data_entrada?: string
          fornecedor?: string | null
          id?: string
          numero_nf?: string | null
          observacao?: string | null
          produto_id?: string
          quantidade?: number
          sala_id?: string
          usuario_responsavel?: string | null
          usuario_responsavel_nome?: string | null
          valor_total?: number | null
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "entradas_estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entradas_estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entradas_estoque_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque: {
        Row: {
          ativo: boolean
          custo_medio: number
          id: string
          produto_id: string
          quantidade: number
          quantidade_reservada: number
          quantidade_valorizada: number
          sala_id: string
          updated_at: string
          valor_total: number
        }
        Insert: {
          ativo?: boolean
          custo_medio?: number
          id?: string
          produto_id: string
          quantidade?: number
          quantidade_reservada?: number
          quantidade_valorizada?: number
          sala_id: string
          updated_at?: string
          valor_total?: number
        }
        Update: {
          ativo?: boolean
          custo_medio?: number
          id?: string
          produto_id?: string
          quantidade?: number
          quantidade_reservada?: number
          quantidade_valorizada?: number
          sala_id?: string
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          attachment_type: string | null
          body: string | null
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_type?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_type?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      movimentacoes: {
        Row: {
          created_at: string
          custo_unitario_aplicado: number | null
          id: string
          observacao: string | null
          produto_id: string
          quantidade: number
          referencia_id: string | null
          referencia_tipo: string | null
          sala_id: string
          saldo_apos: number
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_id: string | null
          valor_financeiro: number | null
        }
        Insert: {
          created_at?: string
          custo_unitario_aplicado?: number | null
          id?: string
          observacao?: string | null
          produto_id: string
          quantidade: number
          referencia_id?: string | null
          referencia_tipo?: string | null
          sala_id: string
          saldo_apos: number
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_id?: string | null
          valor_financeiro?: number | null
        }
        Update: {
          created_at?: string
          custo_unitario_aplicado?: number | null
          id?: string
          observacao?: string | null
          produto_id?: string
          quantidade?: number
          referencia_id?: string | null
          referencia_tipo?: string | null
          sala_id?: string
          saldo_apos?: number
          tipo?: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_id?: string | null
          valor_financeiro?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_states: {
        Row: {
          created_at: string
          is_dismissed: boolean
          is_read: boolean
          notification_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_dismissed?: boolean
          is_read?: boolean
          notification_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_dismissed?: boolean
          is_read?: boolean
          notification_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          category: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          is_dismissed: boolean
          is_read: boolean
          link: string | null
          sala_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          category: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          link?: string | null
          sala_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          category?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          link?: string | null
          sala_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      produto_custo_historico: {
        Row: {
          alterado_em: string
          alterado_por: string | null
          alterado_por_nome: string | null
          id: string
          produto_id: string
          valor_anterior: number | null
          valor_novo: number
        }
        Insert: {
          alterado_em?: string
          alterado_por?: string | null
          alterado_por_nome?: string | null
          id?: string
          produto_id: string
          valor_anterior?: number | null
          valor_novo: number
        }
        Update: {
          alterado_em?: string
          alterado_por?: string | null
          alterado_por_nome?: string | null
          id?: string
          produto_id?: string
          valor_anterior?: number | null
          valor_novo?: number
        }
        Relationships: [
          {
            foreignKeyName: "produto_custo_historico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_custo_historico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean
          categoria_id: string | null
          created_at: string
          custo_unitario: number
          descricao: string | null
          estoque_minimo: number
          id: string
          nome: string
          sala_id: string | null
          unidade: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria_id?: string | null
          created_at?: string
          custo_unitario?: number
          descricao?: string | null
          estoque_minimo?: number
          id?: string
          nome: string
          sala_id?: string | null
          unidade?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria_id?: string | null
          created_at?: string
          custo_unitario?: number
          descricao?: string | null
          estoque_minimo?: number
          id?: string
          nome?: string
          sala_id?: string | null
          unidade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          must_change_password: boolean
          nome: string
          sala_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          must_change_password?: boolean
          nome: string
          sala_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          must_change_password?: boolean
          nome?: string
          sala_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      salas: {
        Row: {
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      solicitacao_itens: {
        Row: {
          id: string
          produto_id: string
          quantidade: number
          solicitacao_id: string
        }
        Insert: {
          id?: string
          produto_id: string
          quantidade: number
          solicitacao_id: string
        }
        Update: {
          id?: string
          produto_id?: string
          quantidade?: number
          solicitacao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitacao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacao_itens_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitacoes: {
        Row: {
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          estoque_baixado: boolean
          id: string
          observacao: string | null
          retirado_em: string | null
          retirado_por: string | null
          sala_id: string
          status: Database["public"]["Enums"]["solicitacao_status"]
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          estoque_baixado?: boolean
          id?: string
          observacao?: string | null
          retirado_em?: string | null
          retirado_por?: string | null
          sala_id: string
          status?: Database["public"]["Enums"]["solicitacao_status"]
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          estoque_baixado?: boolean
          id?: string
          observacao?: string | null
          retirado_em?: string | null
          retirado_por?: string | null
          sala_id?: string
          status?: Database["public"]["Enums"]["solicitacao_status"]
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitacoes_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          actor_nome: string | null
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          event_category: string
          event_type: string
          id: string
          metadata: Json
          sala_id: string | null
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          actor_nome?: string | null
          created_at?: string
          description: string
          entity_id?: string | null
          entity_type?: string | null
          event_category?: string
          event_type: string
          id?: string
          metadata?: Json
          sala_id?: string | null
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          actor_nome?: string | null
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          event_category?: string
          event_type?: string
          id?: string
          metadata?: Json
          sala_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sala_ativa: {
        Row: {
          sala_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          sala_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          sala_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sala_ativa_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      user_salas: {
        Row: {
          created_at: string
          sala_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          sala_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          sala_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_salas_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_devolucao_itens_master: {
        Row: {
          devolucao_id: string | null
          emprestimo_item_id: string | null
          id: string | null
          produto_id: string | null
          quantidade: number | null
          valor_total: number | null
          valor_unitario_aplicado: number | null
        }
        Insert: {
          devolucao_id?: string | null
          emprestimo_item_id?: string | null
          id?: string | null
          produto_id?: string | null
          quantidade?: number | null
          valor_total?: number | null
          valor_unitario_aplicado?: number | null
        }
        Update: {
          devolucao_id?: string | null
          emprestimo_item_id?: string | null
          id?: string | null
          produto_id?: string | null
          quantidade?: number | null
          valor_total?: number | null
          valor_unitario_aplicado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "devolucao_itens_devolucao_id_fkey"
            columns: ["devolucao_id"]
            isOneToOne: false
            referencedRelation: "devolucoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_emprestimo_item_id_fkey"
            columns: ["emprestimo_item_id"]
            isOneToOne: false
            referencedRelation: "emprestimo_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_emprestimo_item_id_fkey"
            columns: ["emprestimo_item_id"]
            isOneToOne: false
            referencedRelation: "v_emprestimo_itens_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
        ]
      }
      v_dividas_master: {
        Row: {
          id: string | null
          produto_id: string | null
          sala_credora_id: string | null
          sala_devedora_id: string | null
          saldo: number | null
          updated_at: string | null
          valor_financeiro: number | null
        }
        Insert: {
          id?: string | null
          produto_id?: string | null
          sala_credora_id?: string | null
          sala_devedora_id?: string | null
          saldo?: number | null
          updated_at?: string | null
          valor_financeiro?: number | null
        }
        Update: {
          id?: string | null
          produto_id?: string | null
          sala_credora_id?: string | null
          sala_devedora_id?: string | null
          saldo?: number | null
          updated_at?: string | null
          valor_financeiro?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dividas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_sala_credora_id_fkey"
            columns: ["sala_credora_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_sala_devedora_id_fkey"
            columns: ["sala_devedora_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_emprestimo_itens_master: {
        Row: {
          emprestimo_id: string | null
          id: string | null
          produto_id: string | null
          quantidade: number | null
          quantidade_devolvida: number | null
          valor_total: number | null
          valor_unitario_aplicado: number | null
        }
        Insert: {
          emprestimo_id?: string | null
          id?: string | null
          produto_id?: string | null
          quantidade?: number | null
          quantidade_devolvida?: number | null
          valor_total?: number | null
          valor_unitario_aplicado?: number | null
        }
        Update: {
          emprestimo_id?: string | null
          id?: string | null
          produto_id?: string | null
          quantidade?: number | null
          quantidade_devolvida?: number | null
          valor_total?: number | null
          valor_unitario_aplicado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "emprestimo_itens_emprestimo_id_fkey"
            columns: ["emprestimo_id"]
            isOneToOne: false
            referencedRelation: "emprestimos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimo_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimo_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
        ]
      }
      v_entradas_estoque_master: {
        Row: {
          created_at: string | null
          data_entrada: string | null
          fornecedor: string | null
          id: string | null
          numero_nf: string | null
          observacao: string | null
          produto_id: string | null
          quantidade: number | null
          sala_id: string | null
          usuario_responsavel: string | null
          usuario_responsavel_nome: string | null
          valor_total: number | null
          valor_unitario: number | null
        }
        Insert: {
          created_at?: string | null
          data_entrada?: string | null
          fornecedor?: string | null
          id?: string | null
          numero_nf?: string | null
          observacao?: string | null
          produto_id?: string | null
          quantidade?: number | null
          sala_id?: string | null
          usuario_responsavel?: string | null
          usuario_responsavel_nome?: string | null
          valor_total?: number | null
          valor_unitario?: number | null
        }
        Update: {
          created_at?: string | null
          data_entrada?: string | null
          fornecedor?: string | null
          id?: string | null
          numero_nf?: string | null
          observacao?: string | null
          produto_id?: string | null
          quantidade?: number | null
          sala_id?: string | null
          usuario_responsavel?: string | null
          usuario_responsavel_nome?: string | null
          valor_total?: number | null
          valor_unitario?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "entradas_estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entradas_estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entradas_estoque_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_estoque_master: {
        Row: {
          custo_medio: number | null
          id: string | null
          produto_id: string | null
          quantidade: number | null
          sala_id: string | null
          updated_at: string | null
          valor_total: number | null
        }
        Insert: {
          custo_medio?: number | null
          id?: string | null
          produto_id?: string | null
          quantidade?: number | null
          sala_id?: string | null
          updated_at?: string | null
          valor_total?: number | null
        }
        Update: {
          custo_medio?: number | null
          id?: string | null
          produto_id?: string | null
          quantidade?: number | null
          sala_id?: string | null
          updated_at?: string | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_movimentacoes_master: {
        Row: {
          created_at: string | null
          custo_unitario_aplicado: number | null
          id: string | null
          observacao: string | null
          produto_id: string | null
          quantidade: number | null
          referencia_id: string | null
          referencia_tipo: string | null
          sala_id: string | null
          saldo_apos: number | null
          tipo: Database["public"]["Enums"]["movimentacao_tipo"] | null
          usuario_id: string | null
          valor_financeiro: number | null
        }
        Insert: {
          created_at?: string | null
          custo_unitario_aplicado?: number | null
          id?: string | null
          observacao?: string | null
          produto_id?: string | null
          quantidade?: number | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          sala_id?: string | null
          saldo_apos?: number | null
          tipo?: Database["public"]["Enums"]["movimentacao_tipo"] | null
          usuario_id?: string | null
          valor_financeiro?: number | null
        }
        Update: {
          created_at?: string | null
          custo_unitario_aplicado?: number | null
          id?: string | null
          observacao?: string | null
          produto_id?: string | null
          quantidade?: number | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          sala_id?: string | null
          saldo_apos?: number | null
          tipo?: Database["public"]["Enums"]["movimentacao_tipo"] | null
          usuario_id?: string | null
          valor_financeiro?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_produto_custo_historico_master: {
        Row: {
          alterado_em: string | null
          alterado_por: string | null
          alterado_por_nome: string | null
          id: string | null
          produto_id: string | null
          valor_anterior: number | null
          valor_novo: number | null
        }
        Insert: {
          alterado_em?: string | null
          alterado_por?: string | null
          alterado_por_nome?: string | null
          id?: string | null
          produto_id?: string | null
          valor_anterior?: number | null
          valor_novo?: number | null
        }
        Update: {
          alterado_em?: string | null
          alterado_por?: string | null
          alterado_por_nome?: string | null
          id?: string | null
          produto_id?: string | null
          valor_anterior?: number | null
          valor_novo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "produto_custo_historico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_custo_historico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "v_produtos_master"
            referencedColumns: ["id"]
          },
        ]
      }
      v_produtos_master: {
        Row: {
          ativo: boolean | null
          categoria_id: string | null
          created_at: string | null
          custo_unitario: number | null
          descricao: string | null
          estoque_minimo: number | null
          id: string | null
          nome: string | null
          sala_id: string | null
          unidade: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          categoria_id?: string | null
          created_at?: string | null
          custo_unitario?: number | null
          descricao?: string | null
          estoque_minimo?: number | null
          id?: string | null
          nome?: string | null
          sala_id?: string | null
          unidade?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          categoria_id?: string | null
          created_at?: string | null
          custo_unitario?: number | null
          descricao?: string | null
          estoque_minimo?: number | null
          id?: string | null
          nome?: string | null
          sala_id?: string | null
          unidade?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _aplicar_reserva: {
        Args: { _delta: number; _produto: string; _sala: string }
        Returns: undefined
      }
      _baixar_valorizada: {
        Args: { _produto: string; _quantidade: number; _sala: string }
        Returns: undefined
      }
      _notify_masters: {
        Args: {
          _actor_id: string
          _body: string
          _category: string
          _entity_id: string
          _entity_type: string
          _event_type: string
          _link: string
          _sala_id: string
          _title: string
        }
        Returns: undefined
      }
      _notify_sala: {
        Args: {
          _actor_id: string
          _body: string
          _category: string
          _entity_id: string
          _entity_type: string
          _event_type: string
          _link: string
          _sala: string
          _title: string
        }
        Returns: undefined
      }
      _notify_users: {
        Args: {
          _actor_id: string
          _body: string
          _category: string
          _entity_id: string
          _entity_type: string
          _event_type: string
          _link: string
          _sala_id: string
          _title: string
          _user_ids: string[]
        }
        Returns: undefined
      }
      _recalc_estoque_valor: {
        Args: { _produto: string; _sala: string }
        Returns: undefined
      }
      admin_set_user_salas: {
        Args: { _salas: string[]; _user: string }
        Returns: undefined
      }
      ajustar_estoque: {
        Args: {
          _observacao: string
          _produto: string
          _quantidade: number
          _sala: string
        }
        Returns: number
      }
      arquivar_emprestimo: {
        Args: { _emp: string; _retirado_em?: string; _retirado_por?: string }
        Returns: undefined
      }
      arquivar_solicitacao: {
        Args: { _retirado_em?: string; _retirado_por?: string; _solic: string }
        Returns: undefined
      }
      can_access_conversation: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      comparativo_salas_financeiro: {
        Args: { _from?: string; _to?: string }
        Returns: {
          participacao_pct: number
          quantidade_consumida: number
          sala_id: string
          sala_nome: string
          valor_consumido: number
          valor_em_estoque: number
        }[]
      }
      criar_emprestimo: {
        Args: { _itens: Json; _observacao: string; _sala_origem: string }
        Returns: string
      }
      criar_solicitacao: {
        Args: { _itens: Json; _observacao: string }
        Returns: string
      }
      curva_abc: {
        Args: { _from?: string; _sala?: string; _to?: string }
        Returns: {
          acumulado_pct: number
          classe: string
          participacao_pct: number
          produto_id: string
          produto_nome: string
          valor: number
        }[]
      }
      decidir_emprestimo: {
        Args: { _aprovar: boolean; _emp: string }
        Returns: undefined
      }
      decidir_solicitacao: {
        Args: { _aprovar: boolean; _solic: string }
        Returns: undefined
      }
      disponibilidade_produtos: {
        Args: { _produto_ids: string[] }
        Returns: {
          nivel: string
          produto_id: string
          sala_id: string
          sala_nome: string
        }[]
      }
      editar_emprestimo: {
        Args: {
          _emp: string
          _itens: Json
          _observacao?: string
          _sala_origem: string
        }
        Returns: undefined
      }
      ensure_my_profile: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          must_change_password: boolean
          nome: string
          sala_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      estatisticas_valorizacao: {
        Args: never
        Returns: {
          itens_sem_valor: number
          itens_valorizados: number
          patrimonio_total: number
          percentual_valorizado: number
          produtos_sem_valor: number
          produtos_total: number
          produtos_valorizados: number
        }[]
      }
      evolucao_mensal_financeira: {
        Args: { _meses?: number }
        Returns: {
          mes: string
          quantidade_consumida: number
          valor_compras: number
          valor_consumido: number
        }[]
      }
      excluir_produto: { Args: { _produto: string }; Returns: Json }
      excluir_produto_sala: {
        Args: { _produto: string; _sala: string }
        Returns: Json
      }
      excluir_sala: { Args: { _force?: boolean; _sala: string }; Returns: Json }
      get_or_create_direct_conversation: {
        Args: { _other: string }
        Returns: string
      }
      get_or_create_master_conversation: {
        Args: { _owner?: string }
        Returns: string
      }
      get_or_create_pedido_conversation: {
        Args: { _id: string; _kind: string }
        Returns: string
      }
      get_or_create_sala_conversation: {
        Args: { _sala: string }
        Returns: string
      }
      get_user_sala: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_my_conversations: {
        Args: never
        Returns: {
          id: string
          last_message_at: string
          last_message_body: string
          last_sender_id: string
          owner_user_id: string
          related_emprestimo_id: string
          related_requisicao_id: string
          sala_id: string
          title: string
          type: Database["public"]["Enums"]["conversation_type"]
          unread_count: number
          updated_at: string
        }[]
      }
      listar_minhas_salas: {
        Args: never
        Returns: {
          ativa: boolean
          sala_id: string
          sala_nome: string
        }[]
      }
      listar_system_logs: {
        Args: {
          _actor?: string
          _cursor?: string
          _event_category?: string
          _event_type?: string
          _from?: string
          _limit?: number
          _sala?: string
          _search?: string
          _to?: string
        }
        Returns: {
          actor_email: string | null
          actor_id: string | null
          actor_nome: string | null
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          event_category: string
          event_type: string
          id: string
          metadata: Json
          sala_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "system_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      log_event: {
        Args: {
          _actor_id?: string
          _description: string
          _entity_id?: string
          _entity_type?: string
          _event_category?: string
          _event_type: string
          _metadata?: Json
          _sala_id?: string
        }
        Returns: string
      }
      marcar_senha_trocada: { Args: never; Returns: undefined }
      mark_conversation_read: { Args: { _conv: string }; Returns: undefined }
      patrimonio_global: { Args: never; Returns: number }
      quitar_divida: {
        Args: { _divida: string; _quantidade: number }
        Returns: undefined
      }
      reativar_produto: { Args: { _produto: string }; Returns: undefined }
      registrar_consumo_interno: {
        Args: {
          _motivo: Database["public"]["Enums"]["motivo_consumo"]
          _observacao?: string
          _produto: string
          _quantidade: number
          _sala: string
        }
        Returns: string
      }
      registrar_devolucao: {
        Args: { _emp: string; _itens: Json; _observacao?: string }
        Returns: string
      }
      registrar_entrada_estoque: {
        Args: {
          _data_entrada?: string
          _fornecedor?: string
          _numero_nf?: string
          _observacao?: string
          _produto: string
          _quantidade: number
          _sala: string
          _valor_unitario: number
        }
        Returns: string
      }
      relatorio_categorias_financeiro: {
        Args: { _from?: string; _sala?: string; _to?: string }
        Returns: {
          categoria_id: string
          categoria_nome: string
          participacao_pct: number
          quantidade: number
          valor: number
        }[]
      }
      relatorio_consumo: {
        Args: {
          _categoria?: string
          _from?: string
          _produto?: string
          _sala?: string
          _to?: string
        }
        Returns: {
          categoria_id: string
          categoria_nome: string
          custo_unitario: number
          produto_id: string
          produto_nome: string
          quantidade: number
          sala_id: string
          sala_nome: string
          valor: number
        }[]
      }
      relatorio_consumo_financeiro: {
        Args: {
          _categoria?: string
          _from?: string
          _produto?: string
          _sala?: string
          _to?: string
        }
        Returns: {
          categoria_id: string
          categoria_nome: string
          produto_id: string
          produto_nome: string
          quantidade: number
          sala_id: string
          sala_nome: string
          valor: number
        }[]
      }
      relatorio_consumo_operacional: {
        Args: {
          _categoria?: string
          _from?: string
          _produto?: string
          _sala?: string
          _to?: string
        }
        Returns: {
          categoria_id: string
          categoria_nome: string
          produto_id: string
          produto_nome: string
          quantidade: number
          sala_id: string
          sala_nome: string
        }[]
      }
      relatorio_custo_por_sala: {
        Args: { _from?: string; _to?: string }
        Returns: {
          participacao_pct: number
          quantidade: number
          sala_id: string
          sala_nome: string
          valor: number
        }[]
      }
      relatorio_emprestimos_salas: {
        Args: never
        Returns: {
          emprestados_qtd: number
          emprestados_unidades: number
          recebidos_qtd: number
          recebidos_unidades: number
          sala_id: string
          sala_nome: string
        }[]
      }
      relatorio_top_produtos_financeiro: {
        Args: { _from?: string; _limit?: number; _sala?: string; _to?: string }
        Returns: {
          participacao_pct: number
          produto_id: string
          produto_nome: string
          quantidade: number
          valor: number
        }[]
      }
      reservas_resumo: {
        Args: never
        Returns: {
          itens_reservados: number
          produtos_reservados: number
          salas_com_reserva: number
        }[]
      }
      reset_sistema_total: { Args: { _caller?: string }; Returns: Json }
      seed_categorias_padrao: { Args: never; Returns: undefined }
      send_message: {
        Args: {
          _attachment_name?: string
          _attachment_path?: string
          _attachment_type?: string
          _body: string
          _conv: string
        }
        Returns: string
      }
      set_minha_sala_ativa: { Args: { _sala: string }; Returns: undefined }
      toggle_produto_sala_ativo: {
        Args: { _ativo: boolean; _produto_id: string; _sala_id: string }
        Returns: undefined
      }
      user_has_sala_access: {
        Args: { _sala: string; _user: string }
        Returns: boolean
      }
      valor_estoque_por_sala: {
        Args: never
        Returns: {
          itens_sem_valor: number
          sala_id: string
          sala_nome: string
          total_itens: number
          valor_total: number
        }[]
      }
    }
    Enums: {
      app_role: "master" | "admin" | "analista"
      conversation_type: "direct" | "sala" | "master"
      emprestimo_status: "pendente" | "aprovado" | "rejeitado" | "arquivado"
      motivo_consumo:
        | "consumo_interno"
        | "evento"
        | "uso_administrativo"
        | "uso_operacional"
        | "perda"
        | "avaria"
        | "descarte"
        | "outro"
      movimentacao_tipo:
        | "entrada"
        | "saida"
        | "ajuste"
        | "solicitacao"
        | "estorno"
        | "emprestimo_saida"
        | "emprestimo_entrada"
        | "consumo_interno"
      solicitacao_status: "pendente" | "aprovado" | "rejeitado" | "arquivado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["master", "admin", "analista"],
      conversation_type: ["direct", "sala", "master"],
      emprestimo_status: ["pendente", "aprovado", "rejeitado", "arquivado"],
      motivo_consumo: [
        "consumo_interno",
        "evento",
        "uso_administrativo",
        "uso_operacional",
        "perda",
        "avaria",
        "descarte",
        "outro",
      ],
      movimentacao_tipo: [
        "entrada",
        "saida",
        "ajuste",
        "solicitacao",
        "estorno",
        "emprestimo_saida",
        "emprestimo_entrada",
        "consumo_interno",
      ],
      solicitacao_status: ["pendente", "aprovado", "rejeitado", "arquivado"],
    },
  },
} as const

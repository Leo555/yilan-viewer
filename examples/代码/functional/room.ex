defmodule Chat.Room do
  @moduledoc """
  一个聊天室进程：保存最近消息并广播给订阅者。
  """
  use GenServer

  @max_messages 50

  # Client API

  def start_link(name), do: GenServer.start_link(__MODULE__, name, name: via(name))

  def say(room, user, text) when is_binary(text) and byte_size(text) > 0 do
    GenServer.cast(via(room), {:say, user, text})
  end

  def history(room), do: GenServer.call(via(room), :history)

  defp via(name), do: {:via, Registry, {Chat.Registry, name}}

  # Server callbacks

  @impl true
  def init(name), do: {:ok, %{name: name, messages: []}}

  @impl true
  def handle_cast({:say, user, text}, state) do
    msg = %{user: user, text: text, at: DateTime.utc_now()}
    Phoenix.PubSub.broadcast(Chat.PubSub, "room:#{state.name}", {:new_message, msg})

    {:noreply, update_in(state.messages, &Enum.take([msg | &1], @max_messages))}
  end

  @impl true
  def handle_call(:history, _from, state) do
    {:reply, Enum.reverse(state.messages), state}
  end
end

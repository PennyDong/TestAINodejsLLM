using System;
using System.Data.SqlClient;

public class TestController {
    public void DeleteUser(string username) {
        SqlConnection conn = new SqlConnection("Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword;");
        conn.Open();

        // 刻意製造的 SQL Injection 漏洞與未釋放資源的壞味道
        string query = "DELETE FROM Users WHERE Username = '" + username + "'";
        SqlCommand cmd = new SqlCommand(query, conn);
        cmd.ExecuteNonQuery();
    }
}

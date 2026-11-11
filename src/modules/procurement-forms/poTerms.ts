/** Điều khoản & điều kiện in kèm PO chính thức (theo tệp "PO's condition THEO FORM P-CC-08" của công ty). */
export const PO_TERMS: readonly { title: string; lines: readonly string[] }[] = [
  { title: "ĐỊNH NGHĨA", lines: [
    "“Người mua”: Cá nhân hoặc công ty đồng ý mua Sản phẩm từ nhà cung cấp / nhà thầu.",
    "“Người bán”: Nhà cung cấp / nhà thầu cung cấp Sản phẩm của họ.",
    "“Sản phẩm”: Hàng hóa, dịch vụ, lắp đặt tại Công trình theo Đơn đặt hàng.",
    "“Đơn đặt hàng” (PO): Thỏa thuận / Hợp đồng giữa Người mua và Người bán trong đó Người bán đồng ý thực hiện Công việc hoặc giao Sản phẩm.",
  ] },
  { title: "CHẤP NHẬN", lines: [
    "Đơn đặt hàng này chỉ có hiệu lực khi Người bán chấp nhận vô điều kiện các điều khoản và điều kiện có trong đây, không thể thay đổi mà không có sự chấp thuận bằng văn bản của Người mua.",
    "Việc chấp nhận Đơn đặt hàng này sẽ được thực hiện bằng cách ký một bản sao của Đơn đặt hàng này và trả lại cho Người mua, sau đó một hợp đồng mua bán và giao Sản phẩm đã chỉ định sẽ được hình thành giữa Người mua và Người bán.",
  ] },
  { title: "CHẤT LƯỢNG", lines: [
    "Người mua có quyền kiểm tra và thử nghiệm tất cả Sản phẩm tại nơi giao hàng trước khi chấp nhận.",
    "Người bán bảo đảm rằng Sản phẩm có chất lượng đạt yêu cầu, phù hợp với mục đích sử dụng, không có lỗi về thiết kế, vật liệu và tay nghề, sẽ tuân thủ toàn bộ thông số kỹ thuật, bản vẽ hoặc mẫu của Người mua và sẽ tuân thủ mọi yêu cầu và quy định theo luật định liên quan đến Sản phẩm đó.",
    "Người bán cam kết cung cấp Sản phẩm mới 100% bao gồm Giấy chứng nhận xuất xứ / Giấy chứng nhận chất lượng. Bên cạnh đó, Người bán phải chịu trách nhiệm hoàn lại 100% hoặc thay thế sản phẩm mới mà không mất phí nếu sản phẩm không như cam kết ban đầu.",
  ] },
  { title: "BẢO ĐẢM", lines: [
    "Bên bán cam kết cung cấp dịch vụ bảo hành kịp thời và đầy đủ cho Sản phẩm được cung cấp theo Đơn đặt hàng này.",
    "Thời hạn bảo hành: Kể từ ngày giao Sản phẩm, Bên bán có trách nhiệm bảo hành cho các Sản phẩm được cung cấp. Thời hạn bảo hành được quy định trong danh mục chi tiết các Sản phẩm theo Đơn đặt hàng này.",
    "Người bán sẽ tự sửa chữa và/hoặc thay thế bất kỳ Sản phẩm bị lỗi hoặc bất kỳ bộ phận nào của Sản phẩm trong thời gian bảo hành. Trong trường hợp Sản phẩm bị lỗi, chi phí kiểm tra và thử nghiệm Sản phẩm và tất cả các chi phí liên quan (bao gồm nhưng không giới hạn ở chi phí vận chuyển) sẽ do Người bán chịu.",
    "Bất chấp những điều nêu trên, Người bán vẫn phải chịu trách nhiệm với Người mua về mọi mất mát và thiệt hại phát sinh từ Sản phẩm bị lỗi và/hoặc sự chậm trễ trong dịch vụ bảo hành của Người bán.",
  ] },
  { title: "VẬN CHUYỂN", lines: [
    "Thời gian là yếu tố cốt lõi của Đơn đặt hàng này. Nếu bất kỳ giao hàng nào không theo mọi khía cạnh phù hợp với các điều khoản của Đơn đặt hàng này hoặc lịch trình giao hàng của Người mua, Người mua có quyền từ chối bất kỳ giao hàng nào không được thực hiện và hủy Đơn đặt hàng này mà không phải chịu bất kỳ trách nhiệm nào với Người bán.",
    "Đối với công việc lắp đặt, trong trường hợp Bên bán không thực hiện đúng tiến độ trong vòng 03 ngày kể từ ngày thông báo, Bên mua có quyền chỉ định nhân sự thực hiện các hạng mục công việc để đạt được tiến độ thay cho Bên bán. Chi phí này sẽ được khấu trừ vào giá trị thanh toán và thông báo cho Bên bán bằng văn bản, mức thanh toán là 800.000 VND/1/8 giờ làm việc. Tiền làm thêm giờ (nếu có) được tính theo quy định lao động hiện hành.",
    "Nếu hàng hóa được giao hoặc việc lắp đặt được thực hiện theo từng đợt thì Đơn đặt hàng này vẫn được coi là một hợp đồng duy nhất và không thể tách rời.",
  ] },
  { title: "GIÁ", lines: [
    "Giá và tỷ giá của Người bán cho Sản phẩm sẽ bao gồm tất cả các công việc và chi phí phụ trợ và khác, cho dù được đề cập riêng hay cụ thể hay không, mà là mong muốn hợp lý để thực hiện và hoàn thành việc cung cấp Sản phẩm. Do đó, giá và tỷ giá của Người bán bao gồm, nhưng không giới hạn ở, phí vận chuyển, phí lưu kho, phí lắp đặt, phí và thuế hải quan, tiền bản quyền và tất cả các loại thuế áp dụng.",
  ] },
  { title: "THANH TOÁN VÀ CHẤP NHẬN", lines: ["Việc thanh toán cho Sản phẩm ở đây không có nghĩa là Người mua chấp nhận tình trạng của Sản phẩm."] },
  { title: "SỰ TỪ CHỐI", lines: ["Người mua có quyền từ chối bất kỳ Sản phẩm nào không làm Người mua hài lòng và sẽ không được coi là đã chấp nhận bất kỳ Sản phẩm nào cho đến khi Người mua có thời gian và cơ hội hợp lý để kiểm tra chúng sau khi giao hàng."] },
  { title: "RỦI RO VÀ TÀI SẢN", lines: [
    "Rủi ro về hư hỏng hoặc mất mát Sản phẩm sẽ chỉ chuyển sang Người mua khi Sản phẩm được giao cho Người mua với xác nhận bằng văn bản của cả hai bên, bất kể việc thanh toán có được thực hiện trước khi giao hàng hay không.",
    "Việc chuyển giao quyền sở hữu và/hoặc rủi ro trong Sản phẩm không ảnh hưởng đến bất kỳ quyền từ chối nào có thể phát sinh cho Người mua theo Đơn đặt hàng này.",
  ] },
  { title: "BẢO HIỂM", lines: [
    "Người bán sẽ ký kết các hợp đồng bảo hiểm cho: (1) Vật liệu, thiết bị và tài sản của Người bán được sử dụng để thực hiện và hoàn thành Đơn đặt hàng này; (2) Bảo hiểm tai nạn cho nhân viên và công nhân của Người bán; (3) Trách nhiệm của bên thứ ba; (4) Bảo hiểm theo quy định khác theo yêu cầu của pháp luật.",
    "Người bán phải cung cấp bằng chứng về các chính sách bảo hiểm bắt buộc nêu trên cho Người mua trong vòng 10 ngày kể từ ngày xác nhận Đơn đặt hàng này.",
  ] },
  { title: "SỞ HỮU TRÍ TUỆ", lines: [
    "Người bán bảo đảm rằng không có Sản phẩm hoặc tác phẩm nào được cung cấp theo Đơn đặt hàng này vi phạm bất kỳ bằng sáng chế, bản quyền, quyền thiết kế, nhãn hiệu, nhãn hiệu dịch vụ, tên thương mại, thiện chí, thông tin bí mật, bí mật thương mại hoặc bất kỳ quyền sở hữu trí tuệ nào khác của bên thứ ba.",
    "Người bán sẽ bồi thường và bảo vệ Người mua khỏi mọi hành động, khiếu nại, yêu cầu, trách nhiệm pháp lý, thiệt hại, chi phí, khoản phí và chi phí phát sinh từ hoặc phải chịu do bất kỳ hành vi vi phạm hoặc cáo buộc vi phạm các quyền nêu trên đối với bất kỳ Sản phẩm nào do Người bán cung cấp.",
    "Trong trường hợp có bất kỳ khiếu nại hoặc yêu cầu hành động nào được đưa ra đối với Người mua liên quan đến bất kỳ vấn đề nào nêu trên, Người bán sẽ tự chi trả để cung cấp cho Người mua mọi hỗ trợ mà Người mua có thể yêu cầu, bao gồm việc cung cấp mọi thông tin, nhân lực và tài liệu cho Người mua.",
  ] },
  { title: "BẢN VẼ, THIẾT KẾ", lines: ["Tất cả các bản vẽ, bản thiết kế và các mục khác do Người bán chuẩn bị và được Người mua thanh toán sẽ là tài sản của Người mua và các mục đó (kể cả khi chúng vẫn chưa được thanh toán) sẽ được giao cho Người mua sau khi hoàn tất hoặc chấm dứt Đơn đặt hàng này. Người bán không được giữ lại bất kỳ bản sao nào của chúng trừ khi được Người mua ủy quyền."] },
  { title: "TIỀN PHẠT VI PHẠM HỢP ĐỒNG", lines: [
    "Trong trường hợp Bên bán đơn phương chấm dứt PO này không phải do lỗi của Bên mua, Bên bán có nghĩa vụ hoàn trả số tiền đã thanh toán trong vòng 30 ngày kể từ ngày thông báo (sau khi đã khấu trừ giá trị các Mục đã hoàn thành). Các Mục được coi là đã hoàn thành nếu được Bên mua và Bên bán xác nhận bằng văn bản.",
    "Sẽ áp dụng mức phạt 15% giá trị hợp đồng trong trường hợp Bên mua hoặc Bên bán chấm dứt Hợp đồng mà không có thỏa thuận chung.",
  ] },
  { title: "PHÁP LUẬT", lines: ["Luật điều chỉnh Đơn đặt hàng này là Bộ luật Dân sự Việt Nam số 91/2015/QH13, ngày 24 tháng 11 năm 2015, có hiệu lực thi hành từ ngày 01 tháng 01 năm 2017."] },
];
